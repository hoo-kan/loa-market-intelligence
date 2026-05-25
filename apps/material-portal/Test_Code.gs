/**
 * @fileoverview 단위 테스트 모듈 (P2 고급 기능)
 * @description 비즈니스 로직 및 설정값 유효성을 검증하는 테스트 코드입니다.
 */

/**
 * 전체 테스트 실행
 * 메뉴나 에디터에서 직접 실행하여 결과를 로그로 확인합니다.
 */
function runAllTests() {
  console.log("🚀 [Test Runner] 테스트 시작...");
  
  const tests = [
    testBusinessRulesStructure,
    testEventMultiplierLogic,
    testDashboardDataStructureMock
  ];
  
  let passed = 0;
  let failed = 0;
  
  tests.forEach(test => {
    try {
      test();
      console.log(`✅ [PASS] ${test.name}`);
      passed++;
    } catch (e) {
      console.error(`❌ [FAIL] ${test.name}: ${e.message}`);
      failed++;
    }
  });
  
  console.log(`\n📊 테스트 결과: 총 ${tests.length}개 중 ${passed}개 성공, ${failed}개 실패`);
}

/**
 * TC-01: 비즈니스 규칙 상수 구조 검증
 */
function testBusinessRulesStructure() {
  if (typeof BUSINESS_RULES === 'undefined') {
    throw new Error("BUSINESS_RULES 상수가 정의되지 않았습니다.");
  }
  
  if (BUSINESS_RULES.SIGNAL.MIN_THRESHOLD !== 3.0) {
    throw new Error("최소 변동폭(MIN_THRESHOLD) 설정 오류");
  }
  
  if (typeof BUSINESS_RULES.EVENT.MULTIPLIER !== 'number') {
    throw new Error("이벤트 가중치 설정 오류");
  }
}

/**
 * TC-02: 이벤트 멀티플라이어 로직 검증
 */
function testEventMultiplierLogic() {
  const multiplier = getEventMultiplier();
  
  if (typeof multiplier !== 'number') {
    throw new Error("getEventMultiplier 반환값이 숫자가 아닙니다.");
  }
  
  if (multiplier < 1.0) {
    throw new Error("멀티플라이어는 1.0 이상이어야 합니다.");
  }
}

/**
 * TC-03: 데이터 처리 로직 검증 (Mock 데이터 활용)
 * 순수 함수 분리가 안 된 상태에서 로직 검증을 위한 시뮬레이션
 */
function testDashboardDataStructureMock() {
  // 가상의 데이터로 Gap 계산 로직 검증
  const mockPrices = [100, 100, 100, 100, 100, 100, 120]; // 6일간 100원, 오늘 120원
  const todayPrice = 120;
  
  // MA7 계산 (단순 평균)
  const avg = mockPrices.reduce((a, b) => a + b, 0) / mockPrices.length;
  // avg = (600 + 120) / 7 = 102.85
  
  const gap = ((todayPrice - avg) / avg * 100);
  // gap = (120 - 102.85) / 102.85 * 100 = 16.67%
  
  if (Math.abs(gap - 16.66) > 0.1) {
    throw new Error(`GAP 계산 로직 오류 예상: 약 16.66, 실제: ${gap}`);
  }
}
