const WEATHER_DESCRIPTIONS = {
  0: "맑음",
  1: "구름 조금", 2: "구름 조금", 3: "구름 조금",
};

function getWeatherDesc(code) {
  if (code === 0) return "맑음";
  if (code >= 1 && code <= 3) return "구름 조금";
  if (code >= 45 && code <= 57) return "안개/이슬비";
  if (code >= 61 && code <= 67) return "비";
  if (code >= 71 && code <= 77) return "눈";
  if (code >= 80 && code <= 82) return "소나기";
  if (code >= 95 && code <= 99) return "뇌우";
  return "흐림";
}

async function getWeather(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: "temperature_2m,precipitation,weathercode,windspeed_10m",
    timezone: "Asia/Seoul",
  });
  try {
    const resp = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = await resp.json();
    const current = data.current ?? {};
    const code = current.weathercode ?? 0;
    return {
      temperature: current.temperature_2m ?? "알 수 없음",
      precipitation: current.precipitation ?? 0,
      windspeed: current.windspeed_10m ?? 0,
      description: getWeatherDesc(code),
      code,
    };
  } catch (e) {
    return { description: "날씨 정보 없음", temperature: "알 수 없음", error: e.message };
  }
}

async function searchRestaurants(lat, lon, keyword, kakaoKey) {
  if (!kakaoKey || kakaoKey === "YOUR_KAKAO_API_KEY") {
    return [{ name: "카카오 API 키 미설정 - 플레이스홀더 식당", address: "주소 없음", url: "#" }];
  }
  const params = new URLSearchParams({
    query: keyword,
    x: lon,
    y: lat,
    radius: 1000,
    size: 5,
    sort: "distance",
  });
  try {
    const resp = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?${params}`, {
      headers: { Authorization: `KakaoAK ${kakaoKey}` },
      signal: AbortSignal.timeout(5000),
    });
    const data = await resp.json();
    return (data.documents ?? []).map((doc) => ({
      name: doc.place_name ?? "",
      address: doc.road_address_name || doc.address_name || "",
      distance: doc.distance ?? "",
      url: doc.place_url ?? "#",
      phone: doc.phone ?? "",
    }));
  } catch (e) {
    return [{ name: `검색 오류: ${e.message}`, address: "", url: "#" }];
  }
}

function buildPrompt(meals, weather) {
  const mealText = meals.length > 0 ? meals.map((m) => `- ${m}`).join("\n") : "- 기록 없음";
  const isRainy = weather.precipitation > 0 || (weather.code >= 61 && weather.code <= 99);
  const temp = weather.temperature;
  const weatherDesc = weather.description;

  return `당신은 한국의 전문 영양사이자 식단 추천 AI입니다.

## 사용자 정보
### 최근 식사 기록 (최신순):
${mealText}

### 현재 날씨:
- 날씨 상태: ${weatherDesc}
- 기온: ${temp}°C
- 강수 여부: ${isRainy ? "비/눈 옴" : "없음"}

## 지시사항
위 정보를 바탕으로 다음을 수행하세요:

1. **영양 분석**: 최근 식사 기록에서 부족하거나 과잉된 영양소/식품군을 파악하세요.
2. **오늘 추천 식단**: 아침/점심/저녁 3끼를 추천하세요.
   - 날씨가 비/눈이면 파전, 국물 요리(김치찌개, 순두부찌개, 삼계탕 등) 우선 고려
   - 추운 날씨(15°C 이하)면 따뜻한 요리 우선
   - 더운 날씨(28°C 이상)면 시원한 요리 우선
3. **검색 키워드**: 점심 추천 메뉴를 주변에서 찾기 위한 Kakao 검색 키워드 1개 (예: "김치찌개")

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트 없이 JSON만 출력하세요:

{
  "nutrition_analysis": "영양 분석 내용 (2-3문장)",
  "recommendations": {
    "breakfast": {
      "menu": "메뉴 이름",
      "reason": "추천 이유 (1문장)"
    },
    "lunch": {
      "menu": "메뉴 이름",
      "reason": "추천 이유 (1문장)"
    },
    "dinner": {
      "menu": "메뉴 이름",
      "reason": "추천 이유 (1문장)"
    }
  },
  "restaurant_keyword": "검색키워드"
}`;
}

export async function onRequestPost({ request, env }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "잘못된 JSON 형식입니다." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const meals = body.meals ?? [];
  const lat = parseFloat(body.lat ?? 37.5665);
  const lon = parseFloat(body.lon ?? 126.978);

  const ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  const KAKAO_API_KEY = env.KAKAO_API_KEY;

  // 1. 날씨 조회
  const weather = await getWeather(lat, lon);

  // 2. Claude AI 추천 생성
  let aiResult;
  if (!ANTHROPIC_API_KEY || ANTHROPIC_API_KEY === "YOUR_ANTHROPIC_API_KEY") {
    aiResult = {
      nutrition_analysis: "Anthropic API 키가 설정되지 않았습니다. 실제 분석을 위해 API 키를 설정해주세요.",
      recommendations: {
        breakfast: { menu: "귀리죽", reason: "식이섬유와 단백질 보충" },
        lunch: { menu: "된장찌개 정식", reason: "발효식품으로 장 건강 개선" },
        dinner: { menu: "연어 샐러드", reason: "오메가-3 지방산 보충" },
      },
      restaurant_keyword: "된장찌개",
    };
  } else {
    const prompt = buildPrompt(meals, weather);
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await resp.json();
    let raw = data.content[0].text.trim();
    if (raw.includes("```")) {
      raw = raw.split("```")[1];
      if (raw.startsWith("json")) raw = raw.slice(4);
    }
    aiResult = JSON.parse(raw);
  }

  // 3. 주변 식당 검색
  const keyword = aiResult.restaurant_keyword ?? "맛집";
  const restaurants = await searchRestaurants(lat, lon, keyword, KAKAO_API_KEY);

  const responseData = {
    weather,
    nutrition_analysis: aiResult.nutrition_analysis ?? "",
    recommendations: aiResult.recommendations ?? {},
    restaurants,
    search_keyword: keyword,
  };

  return new Response(JSON.stringify(responseData), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
