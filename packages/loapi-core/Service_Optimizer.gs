/**
 * @fileoverview 시트 성능 최적화 및 구조 분석 서비스 (Service_Optimizer)
 * @description 
 * 대규모 데이터 시트의 성능을 진단하고, 복잡한 AVERAGEIFS 수식을 효율적인 
 * QUERY 문으로 변환하거나 데이터 수집 트리거를 관리하는 기능을 제공합니다.
 */

/**
 * 전역 설정: 메타 분석 엔진의 성능 및 안정성 파라미터
 */
const META_CONFIG = {
  TARGET_CELLS_PER_CHUNK: 50000, // 1회 실행 시 처리할 적정 셀 수
  STOP_TIME_LIMIT: 300,          // 스크립트 실행 제한 시간 (초)
  PROP_KEY: 'META_ANALYSIS_STATE_V51'
};

/**
 * [최적화] 통계 시트의 방대한 수식을 단일 QUERY 문으로 변환하여 수동 관리를 자동화합니다.
 */
function applyAutoQueryOptimization() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dataSheet = ss.getSheetByName('데이터(5분)');
  let statSheet = ss.getSheetByName('통계(시간)');
  
  if (!dataSheet) {
    ss.toast("'데이터(5분)' 시트를 찾을 수 없습니다.", "오류");
    return;
  }
  
  const lastCol = dataSheet.getLastColumn();
  if (lastCol < 5) {
    ss.toast("데이터 시트에 아이템 정보가 부족합니다 (E열 이후 필요).", "알림");
    return;
  }
  
  const headers = dataSheet.getRange(1, 5, 1, lastCol - 4).getValues()[0];
  
  // 쿼리 소스 배열 구성 (시간 데이터 보정 포함)
  const sourceArray = "{ IFERROR('데이터(5분)'!C:C + '데이터(5분)'!A:A/24, \"시간\"), '데이터(5분)'!E:" + _getColName(lastCol) + " }";
  let selectClause = "Col1";
  let labelClause = "Col1 '시간'";
  
  headers.forEach((name, index) => {
    const colIdx = index + 2;
    const escapedName = name.toString().replace(/'/g, "''");
    selectClause += `, AVG(Col${colIdx})`;
    labelClause += `, AVG(Col${colIdx}) '${escapedName}'`;
  });
  
  const queryFormula = `QUERY(INDEX(IFERROR(${sourceArray}*1, ${sourceArray})), "SELECT ${selectClause} GROUP BY Col1 LABEL ${labelClause}", 1)`;
  const finalQuery = `=LET(res, ${queryFormula}, ARRAYFORMULA(IF(res=0, "", res)))`;
  
  if (!statSheet) {
    const res = SpreadsheetApp.getUi().alert("'통계(시간)' 시트가 없습니다. 생성하시겠습니까?", SpreadsheetApp.getUi().ButtonSet.YES_NO);
    if (res === SpreadsheetApp.getUi().Button.YES) {
      statSheet = ss.insertSheet('통계(시간)');
    } else return;
  }
  
  // statSheet.clear();
  statSheet.getRange("A1").setFormula(finalQuery);
  statSheet.activate();
  
  ss.toast("최적화 QUERY 수식이 정상적으로 적용되었습니다.", "완료");
}

/**
 * [트리거] 5분 단위 데이터 수집 트리거를 자동 설정합니다.
 */
function setupAutoTrigger() {
  const FUNC_NAME = "onTimeAddRow";
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const triggers = ScriptApp.getProjectTriggers();
  const existing = triggers.find(t => t.getHandlerFunction() === FUNC_NAME);
  
  if (existing) {
    const res = SpreadsheetApp.getUi().alert("이미 수집 트리거가 존재합니다. 재설정하시겠습니까?", SpreadsheetApp.getUi().ButtonSet.YES_NO);
    if (res !== SpreadsheetApp.getUi().Button.YES) return;
    ScriptApp.deleteTrigger(existing);
  }
  
  ScriptApp.newTrigger(FUNC_NAME).timeBased().everyMinutes(5).create();
  ss.toast("5분 단위 데이터 수집 트리거가 생성되었습니다.", "설정 완료");
}

/**
 * [메타 분석] 시트 전반의 수식 및 패턴을 정밀 분석하여 리포트를 생성합니다. (이어하기 지원)
 */
function runAutoAnalysis() {
  const startTime = new Date().getTime();
  const state = _getStoredState();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const targetSheets = ss.getSheets().filter(s => !s.getName().startsWith('[REPORT]'));
  
  ss.toast("메타 분석 엔진을 기동합니다...", "분석 시작");

  for (let i = state.sheetIndex; i < targetSheets.length; i++) {
    const sheet = targetSheets[i];
    const sheetName = sheet.getName();
    const maxRows = sheet.getMaxRows();
    const lastCols = Math.max(sheet.getLastColumn(), 1);
    const chunkSize = Math.max(Math.floor(META_CONFIG.TARGET_CELLS_PER_CHUNK / lastCols), 100);
    
    while (state.rowCursor <= maxRows) {
      const startRow = state.rowCursor;
      const endRow = Math.min(startRow + chunkSize - 1, maxRows);
      
      const chunkResults = _processRangeData(sheet, startRow, endRow, lastCols);
      _writeReportBatch(chunkResults);
      
      state.rowCursor = endRow + 1;
      _saveCurrentState({ sheetIndex: i, rowCursor: state.rowCursor });
      
      const elapsed = (new Date().getTime() - startTime) / 1000;
      if (elapsed > META_CONFIG.STOP_TIME_LIMIT) {
        ss.toast(`${sheetName} 시트 분석 중 일시 중단되었습니다.`, "타임아웃 방지");
        return;
      }
    }
    state.rowCursor = 1;
    _saveCurrentState({ sheetIndex: i + 1, rowCursor: 1 });
  }
  
  _clearStoredState();
  SpreadsheetApp.getUi().alert("🎉 모든 시트에 대한 정밀 분석이 완료되었습니다!");
}

/**
 * [상태 초기화] 모든 분석 데이터와 진행 상태를 초기화합니다.
 */
function resetAllAnalysis() {
  _clearStoredState();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const reportSheet = ss.getSheetByName("[REPORT] MetaAnalysis");
  if (reportSheet) ss.deleteSheet(reportSheet);
  ss.toast("분석 상태 및 리포트가 초기화되었습니다.", "완료");
}

// --- Internal Helper Functions (Private Area) ---

/**
 * [내부] 시트의 특정 범위를 처리하여 수식 및 데이터 패턴을 분석합니다. (R1C1 패턴 감지 포함)
 * @private
 */
function _processRangeData(sheet, startRow, endRow, lastCol) {
  const sheetName = sheet.getName();
  const rowCount = endRow - startRow + 1;
  const range = sheet.getRange(startRow, 1, rowCount, lastCol);
  const values = range.getValues();
  const formulas = range.getFormulas();
  const formulasR1C1 = range.getFormulasR1C1();
  let results = [];

  // 열별 마지막 수식 패턴 추적 (중복 방지용)
  if (!this._lastPatterns) this._lastPatterns = {};
  if (!this._lastPatterns[sheetName]) this._lastPatterns[sheetName] = new Array(lastCol).fill("");

  for (let r = 0; r < rowCount; r++) {
    const rIdx = startRow + r;
    for (let c = 0; c < lastCol; c++) {
      const val = values[r][c];
      const formula = formulas[r][c];
      const pattern = formulasR1C1[r][c];
      const a1 = _getColName(c + 1) + rIdx;
      
      if (formula) {
        // [중복 삭감 로직] 동일 열에서 수식 패턴(R1C1)이 반복되면 리포트 제외 (시합 방지)
        if (pattern === this._lastPatterns[sheetName][c]) continue;
        
        this._lastPatterns[sheetName][c] = pattern;
        const diag = _checkExpensiveFormula(formula);
        results.push([sheetName, a1, "FORMULA (Pattern Base)", "'" + formula, diag || "동일 패턴 연속 반복은 생략됨"]);
      } else if (rIdx === 1 && val) {
        results.push([sheetName, a1, "HEADER", val, ""]);
      } else if (val && (String(val).startsWith('#') || (typeof val === 'string' && val.includes('/') && val.split('/').length > 5))) {
        results.push([sheetName, a1, "AUDIT", "'" + val, ""]);
      }
    }
  }
  return results;
}

function _getColName(n) {
  let s = "";
  while (n > 0) {
    let m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - m) / 26);
  }
  return s;
}

function _checkExpensiveFormula(f) {
  const expensiveSet = ["IMPORTRANGE", "INDIRECT", "OFFSET", "QUERY", "VLOOKUP"];
  const matched = expensiveSet.filter(e => new RegExp(e, "i").test(f));
  return matched.length > 0 ? `[${matched.join(', ')}]` : "";
}

function _writeReportBatch(data) {
  if (data.length === 0) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let report = ss.getSheetByName("[REPORT] MetaAnalysis");
  if (!report) {
    report = ss.insertSheet("[REPORT] MetaAnalysis");
    report.appendRow(["시트명", "위치", "구분", "내용", "진단 결과"]);
    report.getRange("1:1").setBackground("#444").setFontColor("#fff").setFontWeight("bold");
    report.setFrozenRows(1);
  }
  report.getRange(report.getLastRow() + 1, 1, data.length, data[0].length).setValues(data);
}

function _getStoredState() {
  const p = PropertiesService.getScriptProperties();
  const s = p.getProperty(META_CONFIG.PROP_KEY);
  return s ? JSON.parse(s) : { sheetIndex: 0, rowCursor: 1 };
}

function _saveCurrentState(state) {
  PropertiesService.getScriptProperties().setProperty(META_CONFIG.PROP_KEY, JSON.stringify(state));
}

function _clearStoredState() {
  PropertiesService.getScriptProperties().deleteProperty(META_CONFIG.PROP_KEY);
}
