/**
 * @fileoverview [Service_Integration] 로스트아크 마켓 데이터 통합 및 정규화 엔진
 * @version 10.3.0 (Stable)
 * @description 
 * 분산된 28개 이상의 소스 시트(로우 데이터 파일)에서 수집된 데이터를 중앙 마스터 DB로 통합하는 ETL 파이프라인.
 * 
 * [Architectural Highlights]
 * 1. **Hybrid Data Structure**:
 *    - Cold Data (과거): 값(Values) 형태로 아카이빙하여 시트 연산 부하 제거 (Static Archiving)
 *    - Hot Data (실시간): QUERY 함수로 최신 데이터만 동적 연결 (Dynamic Linking)
 *    -> 정적 전환으로 긴 시계열 품목 조회를 10초+/20초+ → 약 3~4초/7~8초로 단축 (README Challenge 1)
 * 
 * 2. **Resumable Batch Processor**:
 *    - GAS의 6분 실행 시간 제한(Hard Limit)을 극복하기 위한 상태 저장형(Stateful) 배치 엔진
 *    - `PropertiesService`를 활용해 작업 진척도(Checkpoint)를 영구 저장하고, 다음 실행 시 이어서 처리
 *    - Graceful Shutdown: 타임아웃 임박 시 작업을 안전하게 중단하고 상태를 저장
 * 
 * 3. **Smart Position Discovery**:
 *    - 고정된 셀 위치(A1)에 의존하지 않고, '키워드(일간/시간)'를 기반으로 2차원 탐색하여 데이터 입력 위치를 동적으로 결정
 *    - 시트 구조 변경(행/열 추가)에도 코드 수정 없이 적응하는 강건함(Robustness) 확보
 */

// ======================================================================================
// Public Interfaces
// ======================================================================================

/**
 * [Pipeline Trigger] 일간 데이터 통합 파이프라인을 가동합니다.
 * 주로 야간 배치(Daily Batch) 타이머에 의해 실행됩니다.
 */
function updateDailyIntegration() {
  const integrator = new HybridIntegrator('Daily');
  integrator.execute();
}

/**
 * [Pipeline Trigger] 시간 데이터 통합 파이프라인을 가동합니다.
 * 1시간 단위로 실행되며, 가장 방대한 5분 단위 틱 데이터를 집계합니다.
 */
function updateHourlyIntegration() {
  const integrator = new HybridIntegrator('Hourly');
  integrator.execute();
}

/**
 * [Debug Tool] 통합 상태를 강제로 초기화합니다.
 * 시스템 꼬임 발생 시 관리자가 수동으로 리셋할 수 있는 비상 스위치입니다.
 */
function forceResetIntegration() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast('통합 체크포인트 삭제를 시작합니다...', 'Admin Console');
  
  // 상태 저장소(Properties) 클린업
  PropertiesService.getScriptProperties().deleteProperty('CheckPoint_Daily');
  PropertiesService.getScriptProperties().deleteProperty('CheckPoint_Hourly');
  ss.toast('통합 체크포인트 삭제 완료.', 'Success');
}

/**
 * [Recovery] 일간 통합 프로세스 완전 재시작.
 * 데이터 정합성 문제 발생 시 전체 재처리(Re-processing)를 위해 사용.
 */
function resetAndRestartDaily() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const result = SpreadsheetApp.getUi().alert(
    '[Cold Restart Warning]',
    '기존 일간 통합 데이터를 모두 삭제하고 처음부터 다시 시작하시겠습니까?',
    SpreadsheetApp.getUi().ButtonSet.YES_NO
  );
  
  if (result === SpreadsheetApp.getUi().Button.YES) {
    PropertiesService.getScriptProperties().deleteProperty('CheckPoint_Daily');
    ss.toast('일간 통합 체크포인트 삭제 완료. 통합을 시작합니다...', '리셋', 3);
    updateDailyIntegration();
  }
}

/**
 * [Recovery] 시간 통합 프로세스 완전 재시작.
 * 데이터 정합성 문제 발생 시 전체 재처리(Re-processing)를 위해 사용.
 */
function resetAndRestartHourly() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const result = SpreadsheetApp.getUi().alert(
    '[Cold Restart Warning]',
    '기존 시간 통합 데이터를 모두 삭제하고 처음부터 다시 시작하시겠습니까?',
    SpreadsheetApp.getUi().ButtonSet.YES_NO
  );
  
  if (result === SpreadsheetApp.getUi().Button.YES) {
    PropertiesService.getScriptProperties().deleteProperty('CheckPoint_Hourly');
    ss.toast('시간 통합 체크포인트 삭제 완료. 통합을 시작합니다...', '리셋', 3);
    updateHourlyIntegration();
  }
}

// ======================================================================================
// Core Logic: Hybrid Integration Engine
// ======================================================================================

/**
 * [Engine Class] 하이브리드 통합 메인 클래스.
 * Factory Method 패턴을 사용하진 않았으나, Type에 따라 동작을 분기하는 Strategy 패턴의 간소화된 형태를 띱니다.
 */
class HybridIntegrator {
  /**
   * HybridIntegrator 생성자
   * 
   * @description
   * 하이브리드 통합 엔진을 초기화합니다.
   * - 통합 모드(Daily/Hourly)에 따라 타겟 시트와 소스 시트를 결정
   * - 체크포인트 키를 생성하여 이어하기 기능 준비
   * - 타임아웃 가드를 위한 시작 시간 기록
   * 
   * @param {'Daily'|'Hourly'} type - 통합 모드 지정
   */
  constructor(type) {
    this.type = type;
    this.label = (type === 'Daily') ? '일간' : '시간';
    this.ss = SpreadsheetApp.getActiveSpreadsheet();
    this.currentFileId = this.ss.getId();
    this.masterSheetName = `통계(${this.label})`;
    this.sourceSheetName = `통계(${this.label})`;
    
    // 상태 관리를 위한 고유 키 생성
    this.propKey = `CheckPoint_${this.type}`;
    
    // [Timeout Guard] 실행 시간 추적용
    this.startTime = Date.now();
    // GAS 최대 실행시간 6분(360초) 중 안전마진을 고려해 4분(240초)으로 제한
    // 이유: 타임아웃 발생 시 PropertiesService에 체크포인트 저장 시간 확보
    this.timeLimit = 240 * 1000; 
  }

  /**
   * [Main Pipeline] 통합 ETL 프로세스 실행
   * 1. 환경 분석 (Config Analysis)
   * 2. 데이터 마이닝 (Data Discovery)
   * 3. 이어하기 감지 (State Handling)
   * 4. 배치 처리 (Batch Processing)
   * 5. 실시간 연결 (Live Linking)
   */
  execute() {
    console.log(`\n🚀 [통계(${this.label})] 통합 시작`);
    console.time(`총 소요 시간`);
    
    try {
      // 1. 설정 확인
      this.ss.toast(`${this.label} 데이터 설정 확인 중...`, `데이터 통합`);
      const masterSheet = this._getSheetOrThrow(this.masterSheetName);
      
      // 2. Data Discovery: 데이터가 시작될 셀 위치를 지능적으로 탐색
      const keywordPos = this._findKeywordPosition(masterSheet, this.label);
      const dataStartRow = keywordPos.row + 1; // Body Start Row
      const dataStartCol = keywordPos.col; 
      
      // 3. Schema Parsing: 타겟 헤더 구조 파악
      const masterHeaders = this._getHeadersFromCol(masterSheet, keywordPos.row, dataStartCol);
      
      // 4. Source Gathering: 참조 시트에서 워커 파일 URL 수집 (중복/본인 제외)
      const urls = this._getConfigUrls();
      if (urls.length === 0) throw new Error("유효한 URL을 찾을 수 없습니다.");

      const historicUrls = urls.slice(0, -1); // 과거 아카이브용 파일들
      const activeUrl = urls[urls.length - 1]; // 현재 기록 중인 활성 파일

      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📊 [통계(${this.label})] 데이터 통합 시스템`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`소스 파일      : ${urls.length}개 (과거 ${historicUrls.length}개 + 활성 1개)`);
      console.log(`헤더 개수      : ${masterHeaders.length}개`);
      console.log(`키워드 위치    : ${this._columnToLetter(dataStartCol + 1)}${keywordPos.row + 1}`);
      console.log(`데이터 시작    : ${this._columnToLetter(dataStartCol + 1)}${dataStartRow + 1}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

      // 5. State Handling: 중단된 지점(Checkpoint) 확인
      const props = PropertiesService.getScriptProperties();
      const checkpoint = props.getProperty(this.propKey);
      const hasCheckpoint = checkpoint !== null;
      let currentIndex = parseInt(checkpoint || '0', 10);
      
      if (hasCheckpoint) {
        // 체크포인트가 있으면 이어하기 (초기화 안 함)
        this.ss.toast(`${this.label} 데이터 ${currentIndex}번 파일부터 이어하기`, '데이터 통합 이어하기');
        console.log(`이어하기: ${currentIndex + 1}번 파일부터 입력 시작`);
      } else {
        // 체크포인트가 없으면 처음 시작 (초기화)
        this.ss.toast('데이터 초기화 후 시작...', this.label);
        this._clearMasterData(masterSheet, dataStartRow, dataStartCol);
      }

      // 6. Batch Processing: 과거 데이터 순차 처리
      let lastDataRow = dataStartRow;
      if (currentIndex < historicUrls.length) {
        console.log(`\n💾 과거 데이터 아카이빙 (${historicUrls.length}개 파일)`);
        // *중요*: 여기서 타임아웃 발생 시, 처리된 인덱스까지 체크포인트 저장 후 안전 종료
        lastDataRow = this._processHistory(masterSheet, historicUrls, masterHeaders, currentIndex, dataStartRow, dataStartCol);
        
        if (lastDataRow === -1) {
          // Graceful Shutdown triggered
          const nextIdx = parseInt(props.getProperty(this.propKey), 10);
          this.ss.toast(`시간 제한 (${nextIdx}/${historicUrls.length})\n다시 실행하세요`, '중단', -1);
          console.log(`\n⏸️ 시간 제한으로 ${nextIdx}번 파일 완료 후 중단`);
          return;
        }
        console.log(`\n✅ 과거 데이터 아카이빙 완료`);
      }

      // 7. Live Linking: 최신 데이터는 Formula로 연결 (실시간성 확보)
      console.log(`\n🔗 활성 데이터 연결 (수식 생성)`);
      this.ss.toast('최신 데이터 연결 중...', this.label);
      const activeFormula = this._generateQueryFormula(activeUrl, masterHeaders);
      
      // 8. 수식을 마지막 데이터 다음 행에 입력
      const formulaRow = lastDataRow + 1; // 0-based
      const formulaCol = dataStartCol + 1; // 1-based
      masterSheet.getRange(formulaRow, formulaCol).setFormula(activeFormula);
      const cellAddr = `${this._columnToLetter(formulaCol)}${formulaRow}`;
      console.log(`수식 위치      : ${cellAddr}`);
      console.log(`\n✅ 활성 데이터 연결 완료`);
      
      // 8. Finalize: 작업 완료 후 체크포인트 제거
      props.deleteProperty(this.propKey);
      this.ss.toast('통합 완료!', '✅');
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`✅ [통계(${this.label})] 통합 완료`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    } catch (e) {
      console.error(`오류: ${e.message}`);
      console.error(e.stack);
      this.ss.toast(`오류: ${e.message}`, '❌', -1);
    } finally {
      console.timeEnd(`총 소요 시간`);
    }
  }

  /**
   * [Batch Processor] 대용량 과거 파일 아카이빙 로직
   * GAS 실행 시간 한계를 감지하고 스스로 작업을 중단(Self-Stop)하는 지능형 루프를 포함합니다.
   * 
   * @param {Sheet} masterSheet - 타겟 시트
   * @param {string[]} urls - 처리할 파일 목록
   * @param {number} startIndex - 시작 인덱스 (이어하기)
   * @returns {number} 마지막 데이터 행 (타임아웃 시 -1)
   */
  _processHistory(masterSheet, urls, masterHeaders, startIndex, dataStartRow, dataStartCol) {
    let currentRow;
    
    // Resume Logic: 이어하기 시 실제 데이터의 끝을 찾아 append 모드로 전환
    if (startIndex === 0) {
      currentRow = dataStartRow;
    } else {
      const keywordColRange = masterSheet.getRange(dataStartRow + 1, dataStartCol + 1, masterSheet.getMaxRows() - dataStartRow, 1);
      const values = keywordColRange.getValues();

      let lastRowOffset = 0;
      for (let i = 0; i < values.length; i++) {
        if (values[i][0] !== '' && values[i][0] !== null) lastRowOffset = i;
      }
      currentRow = dataStartRow + lastRowOffset + 1;
      console.log(`이어하기: ${currentRow + 1}행부터 입력 시작`);
    }
    
    for (let i = startIndex; i < urls.length; i++) {
      // [Time Guard] GAS 최대 실행시간 6분(360초) 제약 극복 전략
      // - 안전마진 2분을 고려하여 4분(240초)에서 강제 중단
      // - 이유: 타임아웃 발생 시 PropertiesService에 체크포인트 저장 시간 확보
      // - 다음 트리거 실행 시 저장된 지점부터 자동으로 이어서 처리
      if (Date.now() - this.startTime > this.timeLimit) {
        console.log(`⏱️ 시간 제한 도달. 타임아웃 발생 전 강제 중단`);
        return -1; // 타임아웃 시그널 (다음 실행 시 이어하기)
      }

      this.ss.toast(`${this.label} 데이터 통합 중... (${i + 1}/${urls.length})`, '데이터 통합');
      console.log(`[${i + 1}] 통합 시작...`);
      
      try {
        const allData = this._fetchSourceData(urls[i]);
        console.log(`[${i + 1}] 데이터 로드: ${allData.length}행, 헤더: ${allData[0].length}개`);
        const rows = this._mappingSourceData(allData, masterHeaders);
        
        if (rows.length > 0) {
          const targetCol = dataStartCol + 1; // 1-based
          console.log(`[${i + 1}] 쓰기 위치: ${this._columnToLetter(targetCol)}${currentRow + 1}, 크기: ${rows.length}x${rows[0].length}`);
          // 키워드 열부터 데이터 입력
          masterSheet.getRange(currentRow + 1, targetCol, rows.length, rows[0].length).setValues(rows);
          console.log(`[${i + 1}] ✅ 입력 완료`);
          
          // 다음 파일을 위해 행 위치 업데이트
          currentRow += rows.length;
        } else {
          console.log(`[${i + 1}] ⚠️ 데이터 없음 (스킵)`);
        }
      } catch (e) {
        console.error(`[${i + 1}] ❌ 실패: ${e.message}`);
        console.error(e.stack);
      }
      
      // [Auto-Save] 파일 단위 처리 후 체크포인트 갱신 (중복 입력 방지)
      // - 파일 하나 처리 = 체크포인트 전진, 재실행 시 처리분 스킵
      // - 실패한 파일은 로그로 남기고 스킵 — 로그 확인 후 수동 재처리 대상
      PropertiesService.getScriptProperties().setProperty(this.propKey, (i + 1).toString());
    }
    
    return currentRow; 
  }

  /**
   * URL로부터 스프레드시트 데이터를 안전하게 로드
   * @param {string} url - 소스 파일 URL
   * @returns {Array[]} 2차원 데이터 배열
   */
  _fetchSourceData(url) {
    try {
      const fileId = this._extractId(url);
      if (!fileId) {
        throw new Error('유효하지 않은 URL 형식입니다.');
      }

      const sourceSs = SpreadsheetApp.openById(fileId);
      const sourceSheet = sourceSs.getSheetByName(this.sourceSheetName);
      
      if (!sourceSheet) {
        throw new Error(`시트('${this.sourceSheetName}')를 찾을 수 없습니다.`);
      }

      // getDisplayValues로 데이터 서식 보존
      const allData = sourceSheet.getDataRange().getDisplayValues();
      return allData;
    } catch (e) {
      console.error(`[Data Fetch Failure] URL: ${url} | Error: ${e.message}`);
      return [];
    }
  }

  /**
   * 소스 파일 데이터를 마스터 헤더에 맞게 매핑
   * @param {Array[]} data - 소스 파일 데이터
   * @param {string[]} masterHeaders - 마스터 헤더 (키워드 열부터)
   * @returns {Array[]} 2차원 데이터 배열
   */
  _mappingSourceData(data, masterHeaders) {
    // 소스 파일에서 헤더 행 찾기
    const headerRowIdx = this._findHeaderRowIndex(data, this.label);
    const srcHeaders = data[headerRowIdx].map(s => String(s).trim());
    const srcBody = data.slice(headerRowIdx + 1);

    // 헤더 매핑
    const mapping = masterHeaders.map(mh => srcHeaders.indexOf(mh));
    return srcBody.map(row => mapping.map(idx => (idx === -1 || idx >= row.length) ? '' : row[idx]));
  }

  /**
   * 2차원 배열에서 키워드가 포함된 행 인덱스 찾기
   * @param {Array[]} data - 2차원 데이터 배열
   * @param {string} keyword - 검색할 키워드
   * @returns {number} 행 인덱스 (0-based)
   */
  _findHeaderRowIndex(data, keyword) {
    for (let i = 0; i < Math.min(data.length, 20); i++) {
      if (data[i].join('|').includes(keyword)) return i;
    }
    return 0;
  }

  /**
   * 마스터 시트에서 키워드의 정확한 위치(행, 열) 찾기
   * 10x10 범위 내에서 2차원 탐색
   * @param {Sheet} sheet - 마스터 시트
   * @param {string} keyword - 검색할 키워드 ('일간' 또는 '시간')
   * @returns {{row: number, col: number}} 0-based 인덱스
   */
  _findKeywordPosition(sheet, keyword) {
    const values = sheet.getRange(1, 1, 10, 10).getValues();
    for (let row = 0; row < values.length; row++) {
      for (let col = 0; col < values[row].length; col++) {
        if (String(values[row][col]).trim().includes(keyword)) {
          console.log(`키워드 '${keyword}' 발견: ${this._columnToLetter(col + 1)}${row + 1}`);
          return { row: row, col: col };
        }
      }
    }
    console.warn(`키워드 '${keyword}' 미발견. 기본값 A1 사용`);
    return { row: 0, col: 0 };
  }

  /**
   * 특정 행에서 특정 열부터 헤더 추출
   * @param {Sheet} sheet - 시트
   * @param {number} rowIndex - 행 인덱스 (0-based)
   * @param {number} startCol - 시작 열 인덱스 (0-based)
   * @returns {string[]} 헤더 배열
   */
  _getHeadersFromCol(sheet, rowIndex, startCol) {
    const lastCol = sheet.getLastColumn();
    const colCount = lastCol - startCol;
    if (colCount <= 0) return [];
    
    const row = sheet.getRange(rowIndex + 1, startCol + 1, 1, colCount).getValues()[0];
    return row.filter(String).map(v => String(v).trim());
  }

  /**
   * 데이터 영역만 선택적으로 초기화
   * @param {Sheet} sheet - 마스터 시트
   * @param {number} dataStartRow - 데이터 시작 행 (0-based)
   * @param {number} dataStartCol - 데이터 시작 열 (0-based)
   */
  _clearMasterData(sheet, dataStartRow, dataStartCol) {
    const maxRow = sheet.getMaxRows();
    const lastCol = sheet.getLastColumn();
    
    if (maxRow > dataStartRow && lastCol >= dataStartCol) {
      const clearHeight = maxRow - dataStartRow;
      const clearWidth = lastCol - dataStartCol + 1;
      
      if (clearHeight > 0 && clearWidth > 0) {
        sheet.getRange(dataStartRow + 1, dataStartCol + 1, clearHeight, clearWidth).clearContent();
        console.log(`데이터 영역 초기화: ${this._columnToLetter(dataStartCol + 1)}${dataStartRow + 1}:${this._columnToLetter(lastCol)}${maxRow}`);
      }
    }
  }

  /**
   * 활성 파일용 QUERY 수식 생성
   * @param {string} url - 활성 파일 URL
   * @param {string[]} masterHeaders - 마스터 헤더 (키워드 열부터)
   * @returns {string} QUERY 수식 문자열
   */
  _generateQueryFormula(url, masterHeaders) {
    if (!url) return "";
    try {
      const fileId = this._extractId(url);
      const sourceSs = SpreadsheetApp.openById(fileId);
      const sourceSheet = sourceSs.getSheetByName(this.sourceSheetName);
      if (!sourceSheet) return `"시트 없음"`;

      const sampleData = sourceSheet.getRange("1:20").getValues();
      const headerIdx = this._findHeaderRowIndex(sampleData.map(r => r.map(String)), this.label);
      const srcHeaders = sampleData[headerIdx].map(s => String(s).trim());

      // 매핑된 컬럼만 SELECT (빈 값 제외)
      const selectClauses = masterHeaders
        .map(mh => {
          const idx = srcHeaders.indexOf(mh);
          return idx !== -1 ? `Col${idx + 1}` : null;
        })
        .filter(c => c !== null);
      
      const labelClauses = selectClauses.map(c => `${c} ''`).join(", ");
      const query = `SELECT ${selectClauses.join(", ")} WHERE Col1 IS NOT NULL LABEL ${labelClauses}`;
      const rangeString = `${this.sourceSheetName}!A${headerIdx + 2}:ZZ`;
      
      // QUERY의 마지막 파라미터 0: 헤더 행 없음 (이미 headerIdx+2로 데이터만 가져옴)
      return `QUERY(IMPORTRANGE("${url}", "${rangeString}"), "${query}", 0)`;
    } catch (e) {
      console.error(`수식 생성 실패: ${e.message}`);
      return `"${e.message}"`;
    }
  }

  /**
   * '참조' 시트에서 유효한 URL 수집
   * - 중복 제거
   * - 본인 파일 제외
   * @returns {string[]} URL 배열
   */
  _getConfigUrls() {
    const s = this.ss.getSheetByName('참조');
    if (!s) return [];
    
    const r = this.ss.getName().includes('강화재료') ? 10 : 5;
    const rawValues = s.getRange(r, 3, 30).getValues().flat();
    
    const validUrls = rawValues.map(v => String(v).trim()).filter(v => /^https?:\/\//i.test(v));
    const uniqueUrls = [...new Set(validUrls)];
    const filteredUrls = uniqueUrls.filter(url => this._extractId(url) !== this.currentFileId);
    
    console.log(`URL 필터링: ${validUrls.length} → ${uniqueUrls.length} → ${filteredUrls.length}`);
    return filteredUrls;
  }

  /**
   * URL에서 파일 ID 추출
   * @param {string} u - URL
   * @returns {string|null} 파일 ID
   */
  _extractId(u) {
    const m = u.match(/[-\w]{25,}/);
    return m ? m[0] : null;
  }

  /**
   * 시트 가져오기 (없으면 에러)
   * @param {string} n - 시트 이름
   * @returns {Sheet}
   */
  _getSheetOrThrow(n) {
    const s = this.ss.getSheetByName(n);
    if (!s) throw new Error(`시트 없음: ${n}`);
    return s;
  }

  /**
   * 열 번호를 엑셀 스타일 문자로 변환
   * @param {number} col - 열 번호 (1-based)
   * @returns {string} 열 문자 (A, B, AA...)
   */
  _columnToLetter(col) {
    let temp, letter = '';
    while (col > 0) {
      temp = (col - 1) % 26;
      letter = String.fromCharCode(temp + 65) + letter;
      col = (col - temp - 1) / 26;
    }
    return letter;
  }
}
