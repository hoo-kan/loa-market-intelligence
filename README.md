# 📉 LOA Market Data Pipeline & Intelligence

> **"1억 1천만 셀(112M Cells) 규모의 시계열 데이터를 수집(Data Engineering)하고, 웹으로 시각화(Web Dev)하여, '최적의 매도 타이밍'이라는 인사이트(Insight)를 제공하는 통합 솔루션"**

<p align="center">
  <img src="./docs/image/Screenshot%20LoMaON_화면_메인%202026-01-27%20at%2003.19.06.JPG" width="90%">
</p>

[![🚀 Live Service](https://img.shields.io/badge/Live_Service-Click_Here-success?style=for-the-badge&logo=google-chrome)](https://script.google.com/macros/s/AKfycbwjmNGug9L31buxl-ceBlYsBWtkvB96huNHmmIJETSqKq6EUi9DvkEbP78jN9gXKnzP/exec)

> **실제 서비스 중**: 소수 사용자 대상 24시간 무중단 운영 중 (2024.07 ~ 현재)

---

## 🚀 프로젝트 소개

**"단순한 홈페이지가 아닙니다. 데이터를 생산하고 소비하는 데이터 에코시스템(Data Ecosystem)입니다."**

이 프로젝트는 게임 내 경제 데이터를 실시간으로 수집하는 **ETL 파이프라인**과, 수집된 대규모 데이터를 분석하여 사용자에게 가치를 전달하는 **웹 대시보드**로 구성되어 있습니다.

- **목표 포지션**: 웹 개발 & 데이터 분석 담당 (Growth Engineer)
- **핵심 역량**:
  - **데이터 수집 자동화**: 외부 API를 활용한 대규모 시계열 데이터 수집 시스템 구축 (GAS Triggers로 24시간 무중단 운영)
  - **비즈니스 효율화**: 대용량 데이터 통합 시 실행 시간 제약(6분)을 극복한 이어하기(Resumable) 처리 로직 구현
  - **웹 기반 인사이트 제공**: 복잡한 데이터를 직관적인 대시보드로 시각화하여 사용자에게 최적의 매도 타이밍 제공

---

## 🏗️ 시스템 구조 (빙산의 일각)

사용자가 보는 웹사이트는 빙산의 일각입니다. 그 아래에는 거대한 데이터 공장이 돌아가고 있습니다.

### 1. **Core Engine: `Lostark API` Library**

- **역할**: 게임사 공식 API와 통신하는 **자체 제작 라이브러리**.
- **기술적 특징 (Deep Dive)**:
  - **Exponential Backoff**: 네트워크 불안정 시 재귀적으로 대기 시간을 늘려가며 재시도하는 안정성 확보.
  - **Crypto Caching**: API 요청 URL과 Payload를 해싱(Base64)하여 고유 키를 생성, 중복 호출을 원천 차단하여 할당량 절약.
  - **Rate Limit Protection**: 429 Error 감지 시 자동으로 쿨다운(Cool-down) 시간을 갖는 스로틀링 로직 탑재.

### 2. **Infrastructure: 7 Workers (Data Engineering Lite)**

- **역할**: 24시간 쉬지 않고 돌아가는 **데이터 채굴 워커(Worker)**.
- **규모**:
  - 현재 **7개의 워커가 가동 중** (과거 파일들은 트리거 중단됨)
  - 총 **5개의 대분류 마스터 시트** (강화재료, 각인서, 보석, 생활&항해, 요리&전투용품)
  - **1분/5분 단위**로 적재되는 데이터양은 **약 1.1억 셀(112M Cells)** 규모 ([상세 보기](./docs/LOA_Data_Volume.md))
  - `LockService`를 통한 동시성 제어(Concurrency Control)로 데이터 무결성 보장.

### 3. **Integration Layer: Hybrid ETL Engine**

- **역할**: 분산된 로우 데이터를 분류별 마스터 시트로 통합.
- **기술적 특징**:
  - **Resumable Batch**: 6개월마다 새 로우 파일 생성 시, 기간별 데이터를 마스터 시트로 통합하는 작업이 필요 (예: 강화재료 통합 약 15분 소요). GAS의 6분 실행 시간 제한을 극복하기 위해 작업 상태(Checkpoint)를 저장하고 끊긴 지점부터 이어가는 로직 구현.
  - **Hybrid Data**: 과거 데이터는 값(Values)으로 아카이빙하고, 최신 데이터는 수식(Formula)으로 연결하여 성능과 실시간성 동시 확보.

---

## 💡 문제 해결 과정 및 인사이트

### 📊 Challenge 1: "1억 셀의 데이터를 어떻게 엑셀(시트)에서 다룰까?"

**문제**: 데이터가 쌓일수록 시트가 무거워져(`Loading...`), 단순 조회에도 10초 이상 소요되는 현상 발생.
**해결 (Hybrid Architecture)**:

- **Archive (Cold)**: 변하지 않는 과거 데이터는 수식을 제거하고 `Text` 값으로 박제(Hard-copy)하여 연산 리소스를 0으로 만듦.
- **Live (Hot)**: 최신 기간 데이터만 수식(`QUERY`)으로 동적 연결.
- **결과**: 과거 데이터를 정적 값으로 변환하여 시트 연산 부하를 제거함으로써 대시보드 응답 속도 향상.

### ⚙️ Challenge 2: "6분 안에 각 분류별 파일들을 모두 통합하라"

**문제**: Google Apps Script의 1회 실행 시간 제한(6분)으로 인해, 각 분류(강화재료, 각인서 등)의 기간별 데이터 파일을 순회하는 도중 스크립트가 강제 종료됨. (예: 강화재료는 9개 파일, 각인서는 3개 파일 등)
**해결 (Resumable Batch Pattern)**:

- 작업 위치(Cursor)를 `PropertiesService`에 저장하는 **'이어하기' 로직** 구현.
- 4분 경과 시 스스로 작업을 안전하게 중단(Graceful Shutdown)하고 다음 트리거에 바통을 넘기는 안전장치 마련.
- **Insight**: 서버리스 환경에서의 긴 작업(Long-running Process)을 처리하는 표준적인 패턴 습득.

### 🎨 Challenge 3: "심미성 vs 반응성" (UX Decision)

**상황**: 최신 UI 트렌드인 Glassmorphism(유리 질감, Blur 효과)을 적용했으나, 데이터량이 많은 차트 렌더링 시 미세한 끊김(Lag) 발생.
**결정**: "데이터 분석 도구의 제1덕목은 **화려함보다 즉각적인 반응성(Responsiveness)**이다."
**조치**: CSS Filter 비용이 높은 블러 효과를 제거하고, 고대비(High-Contrast) 다크 모드로 롤백하여 쾌적한 탐색 경험 제공.
**Insight**: 타협 없는 성능 최적화를 위한 엔지니어링 의사결정 경험.

### 💰 Challenge 4: "비용 효율적인 데이터 파이프라인"

**상황**: 상용 DB를 사용하면 비용이 발생하지만, 개인 프로젝트로서 비용 0원을 유지해야 함.
**해결**:

- **Google Sheets as a Backend**: 구글 시트를 NoSQL처럼 활용하는 구조 설계.
- **Serverless**: 별도의 서버 구축 없이 GAS Trigger만을 활용하여 24시간 자동화 구현.
- **Efficiency**: 중복 API 호출 방지(Cahcing) 및 필요한 데이터만 선별 조회하여 할당량 및 리소스 최적화.

---

## 🛠️ 사용 기술

### 웹 개발 (Web Development)

- **Front-end**: HTML5, CSS3, Vanilla JavaScript
- **데이터 시각화**: Chart.js (시계열 차트, 멀티 축, 줌 기능)
- **UI 프레임워크**: TailwindCSS, Material Design 3
- **반응형 디자인**: 모바일/데스크톱 대응

### 데이터 처리 (Data Processing)

- **스크립팅**: Google Apps Script (JavaScript 기반)
- **데이터 수집**: 외부 API 연동, 자동화 워커 7개 운영
- **데이터 통합**: ETL 파이프라인 (분산 데이터 → 마스터 시트)
- **데이터 집계**: Google Sheets QUERY 함수 (SQL 문법 활용)
- **엑셀 고급 활용**: 1억+ 셀 규모 데이터를 Google Sheets로 관리 ([상세 보기](./docs/LOA_Data_Volume.md))

### 인프라 (Infrastructure)

- **서버리스**: Google Apps Script Triggers (24시간 자동 실행)
- **데이터베이스**: Google Sheets (NoSQL 방식 활용)
- **API 라이브러리**: 자체 제작 (Exponential Backoff, Caching)

---

## 📊 데이터 구조 (엑셀 활용 증명)

**Google Sheets 고급 활용 경험**을 직접 확인하실 수 있도록 실제 데이터 시트를 뷰어 전용으로 공개합니다.

- **데이터 규모**: 1억+ 셀 ([상세 보기](./docs/LOA_Data_Volume.md))
- **샘플 데이터**: 로컬 CSV 파일 참조 ([강화재료 5분 데이터 샘플](./docs/data-sheet/))
- **실제 데이터 시트 (뷰어 전용)**:
  - [강화재료 시세 데이터 (26.01.01-26.06.30)](https://docs.google.com/spreadsheets/d/1EM8bRvk8t3uk_TGjsSct3nElROibMnVXziYXsPH6Bv4) - 읽기 전용
  - 5분 단위 실시간 수집 데이터 (현재 7,377행+)
  - Google Sheets QUERY 함수 활용 예시 포함

> **참고**: 요청 시 마스터 시트도 뷰어 권한으로 공개 가능합니다.

---

### 📸 화면 구성

### 목록 화면

<p align="center">
  <img src="./docs/image/Screenshot%20LoMaON_화면_목록%202026-01-27%20at%2003.19.06.JPG" width="80%">
</p>

### 차트 화면

<p align="center">
  <img src="./docs/image/Screenshot%20LoMaON_화면_차트%202026-01-27%20at%2003.35.17.JPG" width="80%">
</p>

---

## 📬 Contact

- **Email**: skyzzango@naver.com
- **Github**: [hoo-kan](https://github.com/hoo-kan)
