/**
 * @fileoverview 로스트아크 거래소 데이터 처리 서비스 (Lean Edition)
 * @author hoo-kan
 */

/** @constant {Object} 거래소 카테고리 정의 */
const MARKET_CATEGORIES = {
  '생활': { // 35
    'code': 90000,
    'subs': {
      '식물채집 전리품': 90200,
      '벌목 전리품': 90300,
      '채광 전리품': 90400,
      '수렵 전리품': 90500,
      '낚시 전리품': 90600,
      '고고학 전리품': 90700,
      '기타': 90800
    }
  },
  '요리': { // 111
    'code': 70000
  },
  '전투 용품': { // 52
    'code': 60000,
    'subs': {
      '배틀 아이템 -회복형': 60200,
      '배틀 아이템 -공격형': 60300,
      '배틀 아이템 -기능성': 60400,
      '배틀 아이템 -버프형': 60500
    }
  },
  '강화 재료': { // 78
    'code': 50000,
    'subs': {
      '재련 재료': 50010,
      '재련 추가 재료': 50020,
      '기타 재료': 51000,
      '무기 진화 재료': 51100
    }
  },
  '각인서': { // 43(129)
    'code': 40000
  },
  '모험의 서': { // 140
    'code': 100000
  },
  '항해': { // 4
    'code': 110000
  }
}

/**
 * [Advanced] 거래소 API를 호출하여 아이템별 현재 최저가를 수집합니다.
 * @param {string[]} categoryList - 조회할 카테고리 이름 배열
 * @param {string} apiKey - API 인증 키
 * @returns {Object} { "아이템명": 데이터객체 } 형태의 결과 맵
 */
function getMarketPriceMap(categoryList, apiKey) {
  const endpoint = buildApiUrl(['markets', 'items']);
  const priceMap = {};

  categoryList.forEach(categoryName => {
    const categoryInfo = MARKET_CATEGORIES[categoryName];
    if (!categoryInfo) return;

    const requestBody = {
      "CategoryCode": categoryInfo.code,
      "ItemGrade": categoryName === "각인서" ? "유물" : null,
      "Sort": "GRADE",
      "SortCondition": "ASC",
      "PageNo": 1
    };

    let totalPages = 1;
    while (requestBody.PageNo <= totalPages) {
      const data = fetchPost(endpoint, apiKey, requestBody);
      if (!data || !data.Items) break;

      totalPages = Math.ceil(data.TotalCount / data.PageSize);
      data.Items.forEach(item => {
        let displayName = item.Name;
        if (displayName.includes("의 젬")) displayName = `(${item.Grade}) ${displayName}`;
        if (!priceMap.hasOwnProperty(displayName)) priceMap[displayName] = item;
      });
      requestBody.PageNo++;
    }
  });
  return priceMap;
}

/**
 * [Legacy] 기존 거래소 시세 수집기.
 * @param {string[]} cate - 카테고리 명칭 배열
 * @param {string} apikey - API 인증 키
 * @returns {Object} 시세 데이터 맵
 */
function get_market_price(cate, apikey) {
  var url = buildApiUrl(['markets', 'items']);
  var items = {};

  for (i in cate) {
    var options = {
      "CategoryCode": MARKET_CATEGORIES[cate[i]]['code'],
      "ItemGrade": cate[i] == "각인서" ? "유물" : null,
      "Sort": "GRADE",
      "SortCondition": "ASC",
      "PageNo": 1
    };

    while (options['PageNo'] == 1 || options['PageNo'] <= Math.ceil(data['TotalCount'] / data['PageSize'])) {
      var response = fetch_Post(url, apikey, options);
      if (!response)
        break;
      var content = response.getContentText();
      var data = JSON.parse(content);

      for (j in data['Items']) {
        var name = data['Items'][j]["Name"];
        if (name.includes("의 젬")) 
          name = `(${data['Items'][j]["Grade"]}) ${name}`;
        if (!items.hasOwnProperty(name)) {
          items[name] = data['Items'][j];
        }
      }

      options["PageNo"]++;
    }
  }

  return items;
}










