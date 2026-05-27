# 로스트아크 시세 데이터 파이프라인 & 대시보드

> 로스트아크 인게임 시세를 5분 주기로 자동 수집해 "최적의 매도 타이밍"을 알려주는 대시보드.
> Google Apps Script만으로 서버 비용 0원, 24시간 무중단 운영 (2021.12 수집 시작 · 2024.07 서비스 공개 · 현재 운영 중).

<p align="center">
  <img src="./docs/image/Screenshot%20LoMaON_화면_메인%202026-01-27%20at%2003.19.06.JPG" width="90%">
</p>

[![Live Service](https://img.shields.io/badge/Live_Service-Click_Here-success?style=for-the-badge&logo=google-chrome)](https://script.google.com/macros/s/AKfycbwjmNGug9L31buxl-ceBlYsBWtkvB96huNHmmIJETSqKq6EUi9DvkEbP78jN9gXKnzP/exec)

## 한눈에

| | |
|---|---|
| **역할** | 백엔드·데이터 엔지니어링 — ETL 파이프라인 + 웹 대시보드 |
| **스택** | Google Apps Script · Google Sheets · Chart.js |
| **규모 / 기간** | 2021.12 수집 시작 · 2024.07 공개 · 4년+ 운영 · 5분 주기 수집 · 워커 7개 |
| **성과** | 긴 시계열 조회 10초+/20초+ → 약 3~4초/7~8초 · 4년 무중단 · 서버 비용 월 0원 |
| **상태** | 운영 중 — [Live Service](https://script.google.com/macros/s/AKfycbwjmNGug9L31buxl-ceBlYsBWtkvB96huNHmmIJETSqKq6EUi9DvkEbP78jN9gXKnzP/exec) |

---

## 프로젝트 소개

게임 내 경제 데이터를 자동 수집하는 **ETL 파이프라인**과, 수집한 데이터를 매도 타이밍 신호로 가공해 보여주는 **웹 대시보드**, 두 부분으로 구성됩니다.

### 핵심 역량 (백엔드 전이)

스택은 Google Apps Script지만, 이 프로젝트에서 증명되는 역량은 매체와 무관하게 백엔드로 전이됩니다.

- **외부 API 연동·안정성**: 지수 백오프(Exponential Backoff) 재시도, 요청 URL·Payload 해싱 캐시로 중복 호출 차단, 429 감지 시 백오프 대기 후 재시도.
- **대용량 데이터 처리**: 4년 이상 누적된 시계열 데이터를 Hot/Cold로 분리해 조회 부하 제거.
- **장시간 작업 처리**: 서버리스 실행 시간 제한(6분)을 체크포인트 '이어하기'로 극복 — Long-running Process의 표준 패턴.
- **동시성 제어**: `LockService`로 다중 워커 간 데이터 무결성 보장.
- **무중단 운영**: 트리거 자동화, 4분 시점 Graceful Shutdown, 수동 복구 스위치.

---

## 시스템 구조

웹 대시보드는 표면이고, 그 뒤에 3계층이 있습니다.

### 1. Core: 로스트아크 API 통신 라이브러리 (자체 제작) — [`packages/loapi-core`](./packages/loapi-core)
게임사 공식 API와 통신하는 라이브러리. 지수 백오프 재시도, 요청 해싱 캐시(중복 호출 차단), 429 감지·백오프 재시도.

### 2. Workers: 24시간 수집 워커 — [`apps/data-worker-example`](./apps/data-worker-example)
현재 7개 워커 가동(5개 분류 × 5분 + 변동성 큰 2개 × 1분). `LockService`로 동시 실행 시 데이터 무결성 보장. 적재 볼륨은 [데이터 규모 문서](./docs/LOA_Data_Volume.md) 참고.

### 3. Integration: 분산 데이터 통합 ETL — [`Service_Integration.gs`](./packages/loapi-core/Service_Integration.gs)
분산 로우 데이터를 분류별 마스터 시트로 통합. **Resumable Batch**(6분 제한을 체크포인트로 극복)·**Hybrid Data**(과거=정적 값, 최신=수식 연결).

**왜 이 구조인가**: 유료 DB 대신 **Google Sheets** — 개인 프로젝트로 비용 0·낮은 러닝커브, 누적 시계열 부하는 Hot/Cold 분리로 감당. 별도 서버 대신 **GAS Trigger** — 인프라 없이 24h 자동화. 운영 안정성은 LockService(동시성)·4분 Graceful Shutdown·수동 복구 스위치로 확보.

---

## 문제 해결 과정

### Challenge 1 — 누적 데이터로 느려진 시트를 어떻게 다룰까
**문제**: 데이터가 쌓일수록 시트가 무거워져 단순 조회에도 10초 이상 걸렸습니다.
**해결 (Hybrid Architecture)**: 과거 데이터는 수식을 제거하고 `Text` 값으로 박제(Cold), 최신 기간만 수식(`QUERY`)으로 동적 연결(Hot).
**결과**: 정적 값 전환 전 긴 시계열 품목 조회가 10초 이상(특히 긴 항목 20초 이상) 걸렸으나, 전환 후 각각 약 3~4초·7~8초 수준으로 단축.

### Challenge 2 — 6분 안에 분류별 파일을 모두 통합하라
**문제**: GAS의 1회 실행 시간 제한(6분) 때문에 기간별 파일을 순회하던 중 스크립트가 강제 종료됨(예: 강화재료 9개 파일).
**해결 (Resumable Batch)**: 작업 위치(Cursor)를 `PropertiesService`에 저장하는 '이어하기' + 4분 경과 시 Graceful Shutdown으로 다음 트리거에 인계.
**배운 점**: 서버리스 환경의 Long-running Process 처리 표준 패턴.

### Challenge 3 — 심미성 vs 반응성 (UX 의사결정)
**상황**: Glassmorphism(Blur)을 적용했더니 데이터량 많은 차트에서 끊김 발생.
**결정·조치**: 데이터 도구의 제1덕목은 반응성이라 판단 → 카드·리스트의 블러 제거(모달 배경 블러만 유지), 고대비 다크 모드로 롤백.
**배운 점**: 좋아 보이는 것을 의도적으로 버린 트레이드오프 판단.

### Challenge 4 — 비용 0원 파이프라인
**해결**: 구글 시트를 NoSQL처럼 활용(Sheets as a Backend) + GAS Trigger만으로 24h 자동화 + 중복 API 호출 방지로 할당량 절약.

---

## 사용 기술

**데이터 처리** — Google Apps Script · 외부 API 연동 · ETL 파이프라인 · Google Sheets QUERY(SQL 문법)
**인프라** — GAS Triggers(서버리스 24h) · Google Sheets(NoSQL 활용) · 자체 API 라이브러리(Backoff·Caching)
**웹** — HTML5 · CSS3 · Vanilla JS · Chart.js(시계열·멀티축·줌) · TailwindCSS · Material Design 3

---

## 테스트

`apps/material-portal/Test_Code.gs`에 비즈니스 규칙·이벤트 가중치 단위 테스트와 Gap 산식 검산(TC-01~03)을 작성했습니다. GAS 에디터에서 `runAllTests()`로 실행합니다. (일부는 아래 '공개 범위'에서 제외한 설정값에 의존하므로 운영 환경에서 동작합니다.)

---

## 데이터 구조

실제 데이터 시트를 **뷰어 전용(읽기 전용)**으로 공개합니다.

- **데이터 규모**: 5분 주기 · 4년+ 누적 ([상세](./docs/LOA_Data_Volume.md))
- **샘플 데이터**: [강화재료 5분 데이터 샘플 (로컬 CSV)](./docs/data-sheet/)
- **실제 시트**: [강화재료 시세 시트 (실시간 수집)](https://docs.google.com/spreadsheets/d/1EM8bRvk8t3uk_TGjsSct3nElROibMnVXziYXsPH6Bv4) — 5분 단위 실시간 수집, QUERY 함수 활용 예시 포함

---

## 화면 구성

<p align="center">
  <img src="./docs/image/Screenshot%20LoMaON_화면_목록%202026-01-27%20at%2003.19.06.JPG" width="80%">
</p>
<p align="center">
  <img src="./docs/image/Screenshot%20LoMaON_화면_차트%202026-01-27%20at%2003.35.17.JPG" width="80%">
</p>

---

## 현재 상태 · 범위

- **상태**: 소수 사용자 대상 24시간 무중단 운영 중 (2021.12 수집 시작 · 2024.07 서비스 공개).
- **공개 범위**: 운영 시스템에서 **핵심 로직 일부를 발췌**해 공개했습니다. 핵심 엔진(`packages/loapi-core`)과 워커·포털 예시를 담되, 시트 ID·비즈니스 규칙 등 배포 환경 종속 설정값(`SHEET_CONFIG`·`BUSINESS_RULES`·`Constants.gs` 등)과 여기 딸린 일부 라이브러리 함수는 제외 — 따라서 일부 파일은 그대로 실행되지 않을 수 있습니다.
- **커밋 이력**: 발췌 공개 시점에 재구성한 것으로, 실제 개발·운영 시점(2021.12~)과 다릅니다.

---

## 개발 과정 · 문서

- [Service_Integration 기술 명세서](./docs/LOA_Service_Integration_Docs.md) — 통합 ETL 엔진의 설계·진화(Phase 1→3)·알고리즘 상세.
- [데이터 규모 · 구조](./docs/LOA_Data_Volume.md) — 분산 저장(Sharding)·아카이브 전략과 데이터 볼륨.

---

## Author

- GitHub [@hoo-kan](https://github.com/hoo-kan)

> 이 프로젝트로 보여주려는 것: 외부 API·ETL·동시성·장시간 작업·무중단 운영을 비전형 스택에서 직접 설계·운영한 경험.
