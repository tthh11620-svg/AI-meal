// 에뮬레이터(localhost:5000)와 배포 환경 자동 분기
// 에뮬레이터에서는 Hosting rewrites가 동작하므로 /api 그대로 사용 가능
const API_URL = "/api";

document.addEventListener("DOMContentLoaded", () => {
  // 초기 입력행에 Enter 키 이벤트 등록
  document.querySelector(".meal-input").addEventListener("keydown", handleEnterKey);

  // file:// 직접 열기 경고
  if (location.protocol === "file:") {
    showError(
      "⚠️ index.html을 직접 열었습니다. API 통신이 불가합니다.\n" +
      "Firebase 에뮬레이터(firebase emulators:start) 또는 배포 후 사용해주세요."
    );
  }
});

let userLat = null;
let userLon = null;

// 식사 행 추가
function addMealRow() {
  const list = document.getElementById("meal-list");
  const row = document.createElement("div");
  row.className = "meal-row";
  row.innerHTML = `
    <input type="text" placeholder="예: 삼겹살, 된장찌개, 치킨..." class="meal-input" />
    <button class="btn-remove" onclick="removeMeal(this)" title="삭제">✕</button>
  `;
  list.appendChild(row);
  const input = row.querySelector("input");
  input.focus();
  input.addEventListener("keydown", handleEnterKey);
}

// Enter 키로 다음 행 추가 또는 제출
function handleEnterKey(e) {
  if (e.key !== "Enter") return;
  const inputs = Array.from(document.querySelectorAll(".meal-input"));
  const idx = inputs.indexOf(e.target);
  if (idx === inputs.length - 1) {
    // 마지막 행이면 새 행 추가
    addMealRow();
  } else {
    inputs[idx + 1].focus();
  }
}

// 식사 행 삭제
function removeMeal(btn) {
  const list = document.getElementById("meal-list");
  if (list.children.length <= 1) {
    btn.closest(".meal-row").querySelector("input").value = "";
    return;
  }
  btn.closest(".meal-row").remove();
}

// GPS 위치 가져오기
function getLocation() {
  const status = document.getElementById("location-status");
  const btn = document.querySelector(".btn-location");

  if (!navigator.geolocation) {
    status.textContent = "이 브라우저는 위치 정보를 지원하지 않습니다.";
    return;
  }

  status.textContent = "위치 확인 중...";
  btn.disabled = true;

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userLat = pos.coords.latitude;
      userLon = pos.coords.longitude;
      status.textContent = `위치 확인됨 (${userLat.toFixed(4)}, ${userLon.toFixed(4)})`;
      status.className = "location-status active";
      btn.disabled = false;
    },
    (err) => {
      status.textContent = "위치 정보를 가져올 수 없습니다. 기본 위치(서울)로 진행합니다.";
      btn.disabled = false;
      userLat = 37.5665;
      userLon = 126.9780;
    },
    { timeout: 8000 }
  );
}

// 추천 요청 전송
async function submitRecommendation() {
  const inputs = document.querySelectorAll(".meal-input");
  const meals = Array.from(inputs)
    .map((i) => i.value.trim())
    .filter((v) => v.length > 0);

  if (meals.length === 0) {
    showError("최소 한 개의 식사 기록을 입력해주세요.");
    return;
  }

  // 위치 미설정 시 기본값(서울시청)
  const lat = userLat ?? 37.5665;
  const lon = userLon ?? 126.9780;

  setLoading(true);
  hideError();

  try {
    const resp = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meals, lat, lon }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `서버 오류 (${resp.status})`);
    }

    const data = await resp.json();
    renderResult(data);
  } catch (e) {
    showError(`요청 실패: ${e.message}`);
  } finally {
    setLoading(false);
  }
}

// 결과 렌더링
function renderResult(data) {
  // 날씨
  const weatherCode = data.weather?.code ?? 0;
  document.getElementById("weather-icon").textContent = getWeatherEmoji(weatherCode, data.weather?.precipitation);
  document.getElementById("weather-desc").textContent = data.weather?.description ?? "알 수 없음";
  const temp = data.weather?.temperature;
  document.getElementById("weather-temp").textContent = temp !== "알 수 없음" ? `${temp}°C` : "-";

  // 영양 분석
  document.getElementById("nutrition-analysis").textContent = data.nutrition_analysis ?? "";

  // 추천 식단
  const recs = data.recommendations ?? {};
  setMeal("breakfast", recs.breakfast);
  setMeal("lunch", recs.lunch);
  setMeal("dinner", recs.dinner);

  // 검색 키워드
  document.getElementById("search-keyword").textContent = `"${data.search_keyword ?? ""}" 검색 결과`;

  // 식당 목록
  const restList = document.getElementById("restaurant-list");
  restList.innerHTML = "";
  const restaurants = data.restaurants ?? [];
  if (restaurants.length === 0) {
    restList.innerHTML = "<p style='color:#888;font-size:0.9rem;'>주변 식당 정보를 찾을 수 없습니다.</p>";
  } else {
    restaurants.forEach((r) => {
      const item = document.createElement("div");
      item.className = "restaurant-item";
      item.innerHTML = `
        <div class="restaurant-info">
          <div class="restaurant-name">${escapeHtml(r.name)}</div>
          <div class="restaurant-address">${escapeHtml(r.address || "주소 정보 없음")}</div>
          ${r.distance ? `<div class="restaurant-distance">${Number(r.distance).toLocaleString()}m</div>` : ""}
        </div>
        ${r.url && r.url !== "#"
          ? `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer" class="restaurant-link">지도 보기</a>`
          : ""}
      `;
      restList.appendChild(item);
    });
  }

  document.getElementById("input-section").classList.add("hidden");
  document.getElementById("result-section").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setMeal(type, mealData) {
  document.getElementById(`${type}-menu`).textContent = mealData?.menu ?? "-";
  document.getElementById(`${type}-reason`).textContent = mealData?.reason ?? "";
}

function getWeatherEmoji(code, precipitation) {
  if (precipitation > 0) {
    if (code >= 71 && code <= 77) return "❄️";
    return "🌧️";
  }
  if (code === 0) return "☀️";
  if (code <= 3) return "⛅";
  if (code <= 48) return "🌫️";
  if (code <= 67) return "🌦️";
  if (code <= 77) return "❄️";
  if (code <= 82) return "🌦️";
  return "⛈️";
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setLoading(on) {
  document.getElementById("loading").classList.toggle("hidden", !on);
  document.querySelector(".btn-submit").disabled = on;
  if (on) document.getElementById("result-section").classList.add("hidden");
}

function showError(msg) {
  const box = document.getElementById("error-box");
  box.textContent = msg;
  box.classList.remove("hidden");
}

function hideError() {
  document.getElementById("error-box").classList.add("hidden");
}

function resetForm() {
  // 식사 입력 초기화 (행 1개만 남기고 비우기)
  const list = document.getElementById("meal-list");
  list.innerHTML = `
    <div class="meal-row">
      <input type="text" placeholder="예: 삼겹살, 된장찌개, 치킨..." class="meal-input" />
      <button class="btn-remove" onclick="removeMeal(this)" title="삭제">✕</button>
    </div>
  `;
  list.querySelector(".meal-input").addEventListener("keydown", handleEnterKey);

  // 위치 초기화
  userLat = null;
  userLon = null;
  const status = document.getElementById("location-status");
  status.textContent = "위치 정보 없음";
  status.className = "location-status";

  document.getElementById("result-section").classList.add("hidden");
  document.getElementById("input-section").classList.remove("hidden");
  hideError();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
