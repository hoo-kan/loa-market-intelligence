/**
 * @fileoverview 로스트아크 시세 분석기 통합 API 서버 (v1.3.0)
 * @description 시트 데이터 추출, 대시보드 분석 및 시계열 데이터 제공
 */

/**
 * 프로젝트 오픈 시 전용 메뉴를 생성합니다.
 */
function onOpen() {
  Loapi.onOpenMenu();
}

// 전역 설정은 Constants.gs의 BUSINESS_RULES를 참조합니다 (공개 범위 제외 — README '현재 상태 · 범위' 참조).

/**
 * 웹 앱 진입점. Index.html 파일을 반환합니다.
 * @return {HtmlService.HtmlOutput}
 */
function doGet() {
  console.log("--- doGet() 실행됨 ---");
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('LOA MARKET ON')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * HTML 파일 내에서 다른 파일을 포함(include)하기 위한 헬퍼 함수
 * @param {string} filename 포함할 파일명 (.html 제외)
 * @return {string} 파일 내용
 */
function includeFile(filename) {
  return HtmlService.createHtmlOutputFromFile(filename)
      .getContent();
}

/**
 * 모든 카테고리의 데이터를 교차 분석하여 급등락 품목을 추출합니다.
 * @description 강화 재료, 각인서를 순회하며 전일 대비 변동폭이 가장 큰 아이템을 선별합니다.
 * @return {Object} gainers(급등), losers(저점), totalCount(전체 품목 수) 포함 객체
 */
function getDashboardData() {
  const cache = CacheService.getScriptCache();
  const cacheKey = "DASHBOARD_V16_INTEGRATED";
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const configs = SHEET_CONFIG;
  if (!configs) throw new Error("존재하지 않는 카테고리입니다.");
  const mapping = getItemCategoryMap();
  let allItems = [];
  
  
  const targetSubCats = ["4T 재련", "4T 보조", "유물 각인서"];
  
  // 비즈니스 로직 상수화 (매직 넘버 제거)
  const MIN_SIGNAL_THRESHOLD = BUSINESS_RULES.SIGNAL.MIN_THRESHOLD; 
  const MIN_ENGRAVING_PRICE = BUSINESS_RULES.FILTER.MIN_ENGRAVING_PRICE;

  Object.keys(configs).forEach(mainCatName => {
    // 분석 대상 시트 제한 (강화 재료, 각인서)
    if (mainCatName !== "강화 재료" && mainCatName !== "각인서") return;

    try {
      const list = getListData(mainCatName); 
      if (list && list.length >= 2) {
        const latest = list[list.length - 1];
        const prev = list[list.length - 2];
        const history7D = list.slice(-7);
        
        Object.keys(latest).forEach(itemName => {
          if (itemName === "일간" || itemName === "updateTime" || !itemName) return;

          // 서브 카테고리 매핑 확인
          const subCat = Object.keys(mapping).find(sub =>
            (mapping[sub] || []).some(kw => itemName.includes(kw))
          );

          if (subCat && targetSubCats.includes(subCat)) {
            const curPrice = latest[itemName];
            if (curPrice <= 0) return;

            // [비즈니스 로직] 각인서 5,000골드 미만 제외
            if (subCat === "유물 각인서" && curPrice < MIN_ENGRAVING_PRICE) return;

            const history = history7D.map(d => d[itemName] || curPrice);
            const avg7 = history.reduce((a, b) => a + b, 0) / history.length;
            const gap = ((curPrice - avg7) / avg7 * 100);

            // [비즈니스 로직] 무의미한 신호 제거 (절대값 3% 기준)
            if (Math.abs(gap) < MIN_SIGNAL_THRESHOLD) return;

            allItems.push({ 
              name: itemName, 
              cat: subCat,      // 화면 표시용 (예: 4T 재련)
              sheet: mainCatName, // 서버 조회용 (예: 강화 재료) -> 상세창 실행 핵심 키
              price: curPrice, 
              diff: prev[itemName] ? ((curPrice - prev[itemName]) / prev[itemName] * 100) : 0, 
              gap: gap
            });
          }
        });
      }
    } catch (e) { console.error(`${mainCatName} 분석 실패: ${e.message}`); }
  });

  // 매도(Exit)와 매수(Floor) 데이터를 방향성에 맞춰 분리 정렬
  const result = {
    gainers: allItems
      .filter(item => item.gap >= MIN_SIGNAL_THRESHOLD)
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 5),
    losers: allItems
      .filter(item => item.gap <= -MIN_SIGNAL_THRESHOLD)
      .sort((a, b) => a.gap - b.gap)
      .slice(0, 5),
    totalCount: allItems.length
  };
  result.updateTime = Utilities.formatDate(new Date(), "GMT+9", "HH:mm:ss");
  result.eventMultiplier = getEventMultiplier();
  // 캐시 적중 응답과 신규 응답의 필드가 일치하도록, 부가 필드까지 채운 뒤 캐싱
  cache.put(cacheKey, JSON.stringify(result), BUSINESS_RULES.CACHE.TTL_SECONDS);

  return result;
}

/**
 * 특정 카테고리의 최신 8행 데이터를 가져옵니다.
 * @param {string} catName - SHEET_CONFIG에 정의된 카테고리명
 * @return {Object[]} 날짜 및 아이템 가격 정보를 담은 객체 배열
 */
function getListData(catName) {
  const cache = CacheService.getScriptCache();
  const cacheKey = "LIST_V16_" + catName;
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  try {
    const config = SHEET_CONFIG[catName];
    if (!config) throw new Error("존재하지 않는 카테고리입니다.");
    const ss = SpreadsheetApp.openById(config.id);
    const sheet = ss.getSheetByName(config.sheetName);
    if (!sheet) throw new Error("존재하지 않는 시트입니다.");
    const fullValues = sheet.getDataRange().getValues();
    const headers = fullValues[config.headerRow - 1].map(h => String(h).trim());
    const validRows = fullValues.slice(config.headerRow).filter(row => row[0] !== "");
    const lastEightRows = validRows.slice(-8);

    const mapping = getItemCategoryMap();
    const keywords = config.subs.flatMap(sub => mapping[sub] || []);
    const targetIndices = headers.reduce((acc, h, i) => {
      if (h === "일간" || keywords.some(k => h.includes(k.trim()))) acc.push(i);
      return acc;
    }, []);

    const result = lastEightRows.map(row => {
      let obj = {};
      targetIndices.forEach(idx => {
        let h = headers[idx];
        let v = row[idx];
        if (v instanceof Date) obj[h] = Utilities.formatDate(v, "GMT+9", "MM-dd(E)");
        else obj[h] = typeof v === 'number' ? Math.round(v) : (v || 0);
      });
      return obj;
    });

    if (result.length > 0) cache.put(cacheKey, JSON.stringify(result), BUSINESS_RULES.CACHE.TTL_SECONDS);
    result.updateTime = Utilities.formatDate(new Date(), "GMT+9", "HH:mm:ss");
    return result;
  } catch (e) { 
    console.error(catName + " 로드 실패: " + e.message);
    return []; 
  }
}

/**
 * 특정 아이템의 전체 시계열 데이터를 가져옵니다 (차트용).
 * 
 * @param {string} catName - SHEET_CONFIG에 정의된 카테고리명 (예: "강화 재료")
 * @param {string} itemName - 아이템 정확한 이름 (예: "운명의 파편 주머니(대)")
 * @returns {Array<{date: string, value: number}>} 날짜별 가격 배열
 * @throws {Error} 시트 접근 실패 또는 아이템 미존재 시
 */
function getDetailData(catName, itemName) {
  const cache = CacheService.getScriptCache();
  const cacheKey = `DETAIL_V16_${catName}_${itemName.replace(/\s/g, '_')}`;
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  try {
    const config = SHEET_CONFIG[catName];
    if (!config) throw new Error(`${catName}는 존재하지 않는 카테고리입니다.`);
    const ss = SpreadsheetApp.openById(config.id);
    const sheet = ss.getSheetByName(config.sheetName);
    const allValues = sheet.getDataRange().getValues();
    const headers = allValues[config.headerRow - 1].map(h => String(h).trim());

    const dateIdx = headers.indexOf("일간");
    const itemIdx = headers.indexOf(itemName.trim());

    if (itemIdx === -1) return [];

    const result = allValues.slice(config.headerRow)
      .filter(row => row[dateIdx] !== "" && row[itemIdx] !== "")
      .map(row => ({
        date: row[dateIdx] instanceof Date ? Utilities.formatDate(row[dateIdx], "GMT+9", "MM-dd(E)") : row[dateIdx],
        value: Math.round(Number(row[itemIdx])) || 0
      })).filter(d => d.value > 0);

    if (result.length > 0) cache.put(cacheKey, JSON.stringify(result), BUSINESS_RULES.CACHE.TTL_SECONDS);
    result.updateTime = Utilities.formatDate(new Date(), "GMT+9", "HH:mm:ss");
    result.eventMultiplier = getEventMultiplier();
    result.quotes = getExchangeRate();
    return result;
  } catch (e) {
    console.error(`Detail Load Error [${catName}/${itemName}]: ${e.message}`);
    return [];
  }
}

/**
 * 이벤트 기간 여부에 따른 시장 분석 가중치 계산
 */
function getEventMultiplier() {
  const today = new Date();
  // 상수 참조로 변경
  const { start, end } = BUSINESS_RULES.EVENT.PERIOD;
  // 이벤트 기간에는 평소보다 가격 상승 허용
  return (today >= start && today <= end) ? BUSINESS_RULES.EVENT.MULTIPLIER : 1.0;
}

/**
 * 골드 환산 실질 가치 계산용 기준 데이터
 * (실제 구현 시 화폐거래소 API나 특정 시트에서 가져오도록 확장 가능)
 */
function getExchangeRate() {
  // 예시: 블루 크리스탈 100개당 골드 가격
  // 이 수치는 별도의 시트에서 실시간 갱신된 값을 가져오는 것을 권장합니다.
  return 7000; 
}

/**
 * 실질 가치(BC) 환산 함수
 * @param {number} price 아이템 골드 가격
 * @return {number} 환산된 BC 가치
 */
function calculateRealValue(price) {
  const bcRate = getExchangeRate();
  // 골드 가격을 BC 단위 가치로 환산 (예: 1000G / 2850G * 100BC = 35.08 BC)
  return (price / bcRate) * 100;
}









