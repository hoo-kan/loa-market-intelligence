/**
 * @fileoverview 실시간 시장 데이터 수집 워커 (v1.0.0)
 * @description 외부 API로부터 데이터를 수집하여 Google Sheets에 동기화합니다.
 * @author hoo-kan
 */

const API_KEY = PropertiesService.getScriptProperties().getProperty('LOSTARK_API_KEY'); 
const CATEGORIES = ['강화 재료'];

const REF_SHEET = '참조';
const STAT_DAY_SHEET = '통계(일간)';
const STAT_WEEK_SHEET = '통계(주간)';
const DATA_SHEET = '데이터(1분)'; 

/**
 * 시트 오픈 시 상단에 분석 메뉴를 생성합니다.
 */
function onOpen() {
  Loapi.onOpenMenu();
}

/**
 * 1분 간격 트리거로 작동하며 시트에 데이터를 기록합니다.
 */
function onTimeAddRow() {
  handleTickUpdate();
}

/**
 * 현재가를 최신가격으로 업데이트 합니다.
 */
function updateCurrentPrice(price) {
  var sn = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = sn.getSheetByName(STAT_DAY_SHEET);

  var r_price = sheet.getRange(1, 2, 1, price.length);
  var v_price = r_price.getValues();

  price.forEach(function(p, i) {
    v_price[0][i] = p;
  });

  r_price.setValues(v_price);

  Logger.log(`[Sheet.code DEBUG] CurrentPrice update success.`);
}

/**
 * @fileoverview [Worker] 실시간 데이터 수집기 (1분/TPM)
 * @description 
 * 이 스크립트는 중앙 라이브러리(Loapi)를 호출하여 1분 단위로 실시간 데이터를 수집하는 
 * 28개 워커 중 하나입니다. (Role: 강화재료 수집)
 * 
 * [Mechanism]
 * 1. Trigger: 1분 주기로 `onTimeAddRow` 실행
 * 2. Concurrency Control: `LockService`를 사용해 중복 실행 및 데이터 경합 방지
 * 3. Library Delegation: 복잡한 로직은 `Loapi`에 위임하고, 결과를 시트에 Appending
 */

function handleTickUpdate() {
  // [Lock] 동시 실행 방지 (최대 30초 대기)
  // GAS 트리거가 때로 겹쳐서 실행될 경우 DB(시트) 무결성을 보장하기 위함
  const lock = LockService.getScriptLock();
  
  try {
    lock.waitLock(30000); 

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(DATA_SHEET);
    
    // [Metadata] 시트 헤더를 읽어 수집할 대상 아이템 목록 동적 로드
    const v_names = sheet.getRange('E1:1').getValues()[0];

    // [Core Call] 라이브러리(Loapi)를 통해 데이터 수집 (추상화된 인터페이스 사용)
    const price = Loapi.getCurrentMinPrice(CATEGORIES, v_names, API_KEY);
    Logger.log(`[Sheet.code DEBUG] price(${price.length}): ${price}`);

    // 유효 데이터 존재 시 기록
    if (price.length > 1) {
      const formattedDate = Utilities.formatDate(new Date(price[0]), "Asia/Seoul", "HH mm yyyy-MM-dd HH:mm");
      var row = formattedDate.split(" ").concat(price.slice(1));
      
      // [DB Write] 최적화된 appendRow 사용 (Batch Write)
      sheet.appendRow(row);
      Logger.log(`[Sheet.code DEBUG] Price appendRow success.`);
      
      // 일간 통계 실시간 동기화 (Hot Data Update)
      updateCurrentPrice(price);
    }
  } catch (e) {
    Logger.log(`[Sheet.code ERR] ${e}`);
  } finally {
    // 안전한 락 해제
    lock.releaseLock();
  }
}
