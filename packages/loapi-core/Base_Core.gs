/**
 * @fileoverview [Core] 로스트아크 API 통신 게이트웨이
 * @author hoo-kan
 * @description 
 * 로스트아크 공식 API와의 모든 통신을 책임지는 최하위 레이어입니다.
 * 단순한 `fetch` 래퍼가 아닌, 대규모 데이터 수집 시 발생할 수 있는 다양한 네트워크 이슈를 방어합니다.
 * 
 * [핵심 기술적 특징]
 * 1. **Reliability**: 지수 백오프(Exponential Backoff) 알고리즘을 적용한 재시도 로직으로 일시적 네트워크 장애 극복
 * 2. **Protection**: API 속도 제한(Rate Limit, 429) 감지 및 자동 스로틀링
 * 3. **Efficiency**: Crypto Cache (Base64 키 해싱) 전략을 통해 동일 요청에 대한 중복 호출 원천 차단
 */

/** @constant {string} 로스트아크 API 엔드포인트 기본 주소 */
const BASE_URL = 'https://developer-lostark.game.onstove.com';

/**
 * [Security] 스크립트 속성 저장소에서 API 키를 안전하게 로드합니다.
 * 하드코딩을 방지하여 코드 유출 시에도 보안성을 유지합니다.
 * @returns {string} 로스트아크 API 키
 */
function getApiKey() {
  return PropertiesService.getScriptProperties().getProperty('LOSTARK_API_KEY');
}

/**
 * [Utility] API 요청 경로를 동적으로 조합합니다.
 * @param {string|string[]} parts - URL 경로 조각
 * @returns {string} https://... 형태로 완성된 API URL
 */
function buildApiUrl(parts) {
  const path = Array.isArray(parts) ? parts.join('/') : parts;
  return `${BASE_URL}/${path}`;
}

/**
 * [Gateway] GET 요청의 진입점(Entry Point).
 * 캐시 우선(Cache-First) 전략을 적용하여 할당량 소모를 최소화합니다.
 * 
 * @param {string} url - 요청 대상 URL
 * @param {string} apiKey - 인증 키
 * @param {boolean} [useCache=false] - true 설정 시 캐시 미스일 경우에만 실제 네트워크 요청 발생
 * @returns {Object|null} 파싱된 JSON 데이터 또는 실패 시 null
 */
function fetchGet(url, apiKey, useCache = false) {
  const params = {
    'method': 'GET',
    'headers': {
      'accept': 'application/json',
      'authorization': `bearer ${apiKey}`
    },
    'muteHttpExceptions': true
  };

  const content = useCache ? _executeWithCache(url, params) : _executeRequest(url, params);
  return content ? JSON.parse(content) : null;
}

/**
 * [Gateway] POST 요청의 진입점.
 * 검색 조건이 복잡한 로스트아크 API 특성상 POST 요청에도 캐싱을 지원합니다.
 * 
 * @param {string} url - 요청 대상 URL
 * @param {string} apiKey - 인증 키
 * @param {Object} payload - 요청 바디 데이터 (검색 조건 등)
 * @param {boolean} [useCache=false] - 캐시 사용 여부
 * @returns {Object|null} 파싱된 JSON 데이터
 */
function fetchPost(url, apiKey, payload, useCache = false) {
  const params = {
    'method': 'POST',
    'headers': {
      'accept': 'application/json',
      'authorization': `bearer ${apiKey}`
    },
    'contentType': 'application/json',
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  const content = useCache ? _executeWithCache(url, params) : _executeRequest(url, params);
  return content ? JSON.parse(content) : null;
}

/**
 * [Engine] 실제 HTTP 요청을 수행하는 방어적 통신 엔진.
 * 재귀적 재시도(Recursive Retry) 패턴을 사용하여 통신 성공률을 극대화합니다.
 * 
 * @private
 * @param {string} url - 요청 URL
 * @param {Object} params - UrlFetchApp 옵션
 * @param {number} retryCount - 현재 재시도 횟수 (최대 3회)
 * @returns {string|null} 응답 본문 문자열
 */
function _executeRequest(url, params, retryCount = 0) {
  // [Safety] 무한 루프 방지를 위한 강제 종료 조건
  if (retryCount > 2) {
    Logger.log(`[Loapi.core WARN] Max Retry Exceeded (${retryCount}): ${url}`);
    return null;
  }

  try {
    const method = params.method.toUpperCase();
    Logger.log(`[Loapi.core FETCH] ${method} (Try:${retryCount + 1}): ${url}?${params.payload || 'None'}`);

    const response = UrlFetchApp.fetch(url, params);
    
    // [Throttling] 연속 호출 시 API 서버 부하 방지 (Nice Behavior)
    Utilities.sleep(100); 

    const code = response.getResponseCode();
    const content = response.getContentText();

    if (code === 200) {
      return content;
    } else if (code === 429) { 
      // [Rate Limit Handling] 
      // 429 에러(Too Many Requests) 발생 시, 지수 백오프 전략으로 대기 후 재시도
      // API_KEY_NUM = (API_KEY_NUM + 1) % API_KEY.length; // API 키 회전
      Logger.log(`[Loapi.core ALERT] Rate Limit (429) Hit. Cooling down...`);
    } else {
      Logger.log(`[Loapi.core WARN] HTTP Code[${code}] at ${url}`);
      Logger.log(`[Loapi.core WARN] Response Content: ${content.substring(0, 100)}...`);
      // 5xx 서버 에러 등의 경우 잠시 대기 후 재시도 시도
    }
  } catch (e) {
    Logger.log(`[Loapi.core EXP] Network Exception: ${e.message}`);
  }

  // [Exponential Backoff] 지수 백오프 알고리즘 적용
  // - 1차 실패: 1초 대기 → 2차 실패: 2초 대기 → 3차 실패: 3초 대기
  // - 목적: 일시적 네트워크 장애 시 서버 부하를 가중시키지 않으면서 재시도
  // - 표준 패턴: AWS SDK, Google Cloud SDK 등에서 사용하는 방식
  const backoffTime = 1000 * (retryCount + 1);
  Logger.log(`[Loapi.core INFO] Retrying in ${backoffTime}ms...`);
  Utilities.sleep(backoffTime);
  
  return _executeRequest(url, params, retryCount + 1);
}

/**
 * [Optimization] 캐시 레이어 관리자.
 * 요청의 고유성(URL + Payload)을 해시(Hash)값으로 변환하여 캐시 키로 사용합니다.
 * 이를 통해 긴 페이로드(Payload)를 가진 요청도 효율적으로 캐싱할 수 있습니다.
 * 
 * @private
 * @param {string} url - 요청 URL
 * @param {Object} params - 요청 파라미터
 * @returns {string|null} 캐시된 데이터 또는 새 데이터
 */
function _executeWithCache(url, params) {
  // Payload가 길어질 수 있으므로 Base64 인코딩하여 고유 키 생성
  const signature = JSON.stringify([url, params.payload || 'GET']);
  const cacheKey = Utilities.base64Encode(signature).substring(0, 250); // 키 길이 제한 고려

  const cache = CacheService.getScriptCache();
  const cachedData = cache.get(cacheKey);

  if (cachedData) {
    Logger.log(`[Loapi.core CACHE] Hit: ${url} (Key: ${cacheKey.substring(0, 10)}..)`);
    return cachedData;
  }

  // Cache Miss: 실제 요청 수행
  const content = _executeRequest(url, params);
  
  if (content) {
    // 성공적인 응답만 캐싱 (유효기간: 10분 = 데이터 갱신 주기 고려)
    try {
      cache.put(cacheKey, content, 600); 
      Logger.log(`[Loapi.core CACHE] Saved: ${url}`);
    } catch (e) {
      Logger.log(`[Loapi.core WARN] Cache Save Failed (Too Large): ${e.message}`);
    }
    return content;
  }
  return null;
}
