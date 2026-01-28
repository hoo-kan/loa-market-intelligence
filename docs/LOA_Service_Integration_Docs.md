# Service_Integration.gs 기술 명세서 (Technical Specification)

## 1. 개요 (Overview)

본 문서는 로스트아크 마켓 데이터의 **대용량 시계열 데이터 통합 파이프라인(`Service_Integration.gs`)**에 대한 기술 문서입니다.
여러 데이터 수집 워커(Worker)가 생성한 분산된 파일의 데이터를 중앙 마스터 시트(Google Sheets)로 무결점 통합하는 ETL(Extract, Transform, Load) 프로세스를 담당합니다.

### 🎯 핵심 설계 목표

1.  **Scale-Out 대응**: 분기 단위로 늘어나는 수집 파일(Raw Data)을 코드 수정 없이 동적으로 탐색 및 병합.
2.  **Resumability (이어하기)**: Google Apps Script(GAS)의 실행 시간 제한(6분)을 극복하기 위해, 작업 상태(Checkpoint)를 영구 저장하여 중단된 지점부터 자동으로 재개.
3.  **Hybrid Connectivity**:
    - **Historical Data**: 변동 없는 과거 데이터는 값(Values)으로 하드카피하여 연산 부하 제거 (Cold Data).
    - **Active Data**: 실시간 적재 중인 최신 데이터는 `QUERY/IMPORTRANGE` 수식으로 연결하여 초단위 최신성 보장 (Hot Data).

---

## 2. 아키텍처 및 데이터 흐름 (System Architecture)

### 2.1 데이터 파이프라인 흐름도

```mermaid
graph LR
    A[Worker Sheets (Raw Data)] -->|Batch Fetch| B(Service_Integration Engine);
    B -->|Check State| C{Checkpoint Exists?};
    C -- Yes --> D[Resume from Last Index];
    C -- No --> E[Full Reload & Reset];
    D --> F[Append Process];
    E --> F;
    F -->|Write Values| G[(Master Sheet / Cold Data)];
    H[Active Worker Sheet] -->|Link Formula| I[(Master Sheet / Hot Data)];
    G --- I;
```

### 2.2 주요 기술적 제약 및 해결책

| 제약 사항 (Constraint)   | 해결 방안 (Solution)                                                                                                             |
| :----------------------- | :------------------------------------------------------------------------------------------------------------------------------- |
| **Execution Time Limit** | GAS의 6분 런타임 제한을 감지하여, 4분 시점에 작업을 안전하게 중단(Graceful Shutdown)하고 진행 상황을 `PropertiesService`에 저장. |
| **Cell Limit (10M)**     | 1억 셀 이상의 잠재적 데이터 처리를 위해 과거 데이터는 수식을 제거하고 값만 저장(Archiving)하여 메모리 리소스 확보.               |
| **Recursion Risk**       | 마스터 시트가 자기 자신을 참조 데이터로 오인하여 무한 루프에 빠지는 것을 방지하기 위한 `Self-ID Filtering` 로직 구현.            |

---

## 3. 알고리즘 및 로직 상세 (Algorithm Details)

### 3.1 스마트 데이터 탐색 (Smart Discovery)

고정된 셀 주소(A1)에 의존하지 않고, 시트 내의 키워드('일간', '시간')를 2차원 배열 탐색으로 찾아내어 데이터의 시작점을 동적으로 결정합니다. 이는 시트의 행/열이 추가되거나 변경되어도 코드 수정 없이 작동하는 **강건함(Robustness)**을 보장합니다.

### 3.2 상태 저장형 배치 처리 (Stateful Batch Processing)

```javascript
// Pseudo Code Architecture
function processHistory(urls, checkpoint) {
  for (let i = checkpoint; i < urls.length; i++) {
    if (isTimeLimitApproaching()) {
      saveCheckpoint(i); // 현재 진행 상황 저장
      return stop(); // 안전 종료
    }
    fetchAndAppend(urls[i]); // 데이터 처리
  }
  deleteCheckpoint(); // 완료 시 상태 초기화
}
```

### 3.3 하이브리드 데이터 모델 (Hybrid Model)

- **Cold Data Area**: 과거 데이터 파일은 루프를 돌며 `getValue()` -> `setValue()`로 마스터 시트에 물리적으로 병합합니다.
- **Hot Data Area**: 가장 마지막(최신) URL은 물리적 병합 대신 `QUERY(IMPORTRANGE(...))` 함수를 마스터 시트 하단에 주입하여, 별도의 트리거 없이도 실시간 데이터가 반영되도록 합니다.

---

## 4. 버전 히스토리 (Evolution History)

### Phase 1: Formula-based (Legacy)

- **방식**: 모든 데이터를 `IMPORTRANGE` 수식으로 연결.
- **한계**: 소스 파일이 늘어날수록 '내부 불러오기 실패'오류 발생 빈도 급증.

### Phase 2: Script-based ETL (Naive)

- **방식**: 매 실행 시 모든 과거 파일을 처음부터 다시 읽어와 덮어쓰기.
- **한계**: 데이터 양이 늘어날수록 실행 시간이 6분을 초과하여 작업이 강제 종료됨(Truncated Data).

### Phase 3: Resumable Batch Engine (Current Production)

- **혁신**: '이어하기' 개념 도입. 작업이 중단되어도 다음 실행 시 정확히 중단된 파일부터 작업을 재개.
- **안전성**: 자기 참조 방지 로직 및 타임아웃 방지 타이머(Watchdog) 탑재로 무중단 운영 실현.
- **성과**: 200만 행 이상의 데이터를 안정적으로 처리하며, 실행 속도와 데이터 무결성을 동시에 확보.

---

## 5. 결론 (Conclusion)

`Service_Integration.gs`는 단순한 데이터 복사 스크립트가 아닌, **Google Apps Script 환경의 물리적 한계를 소프트웨어 아키텍처로 극복**한 사례입니다. 대용량 데이터 처리의 안정성을 최우선으로 설계되었으며, 유지보수 비용을 최소화하는 방향으로 최적화되었습니다.
