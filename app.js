// =========================================================================
// 1. API YAPILANDIRMASI (B'nin API'si hazır olduğunda buradan bağlanacak)
// =========================================================================
const CONFIG = {
  USE_MOCK_API: true, // Gerçek sunucu bağlandığında false yapın
  API_BASE_URL: "http://localhost:8000/api/v1/bus/6002/prediction",
  MOCK_DELAY_MS: 260
};

// Duraklara göre bir önceki durak eşleştirmesi (6002 Incheon Havalimanı yönü)
const STOP_PREV_MAP = {
  "합정역": "홍대입구역",
  "홍대입구역": "신촌역",
  "신촌역": "이대역"
};

// =========================================================================
// 2. GERÇEKÇİ SENARYO VERİLERİ (Mock API Sözleşmesi)
// =========================================================================
const MOCK_SCENARIOS = {
  pending: {
    bus_number: "6002",
    vehicle_id: "서울74사 1234",
    target_stop: "합정역",
    eta_minutes: 6,
    total_seats: 41,
    current_seats: 18,
    prediction_status: "PENDING",
    predicted_seats: null,
    pending_reason:
      "동일 차량 기준 도착 학습 데이터가 충분하지 않아 모델 예측을 보류했습니다. 최소 100건 수집 후 예측 모델이 활성화됩니다.",
    collected_samples: 32,
    required_samples: 100,
    model_info: null,
    recent_arrivals: [
      { vehicle_id: "서울74사 5812", time: "14:15", before_seats: 22, arrival_seats: 17 },
      { vehicle_id: "서울74사 3309", time: "13:55", before_seats: 14, arrival_seats: 9 },
      { vehicle_id: "서울74사 9011", time: "13:35", before_seats: 29, arrival_seats: 25 }
    ],
    updated_at: "14:35:10"
  },

  readySafe: {
    bus_number: "6002",
    vehicle_id: "서울74사 4820",
    target_stop: "합정역",
    eta_minutes: 5,
    total_seats: 41,
    current_seats: 21,
    prediction_status: "READY",
    predicted_seats: 16,
    pending_reason: null,
    collected_samples: 148,
    required_samples: 100,
    model_info: {
      name: "RandomForest v1.0",
      baseline_comparison: "기준선 대비 MAE 1.6석 개선"
    },
    recent_arrivals: [
      { vehicle_id: "서울74사 1234", time: "14:20", before_seats: 20, arrival_seats: 15 },
      { vehicle_id: "서울74사 5812", time: "14:00", before_seats: 24, arrival_seats: 19 },
      { vehicle_id: "서울74사 3309", time: "13:40", before_seats: 18, arrival_seats: 14 }
    ],
    updated_at: "14:38:04"
  },

  readyCrowded: {
    bus_number: "6002",
    vehicle_id: "서울74사 7741",
    target_stop: "합정역",
    eta_minutes: 4,
    total_seats: 41,
    current_seats: 8,
    prediction_status: "READY",
    predicted_seats: 2,
    pending_reason: null,
    collected_samples: 148,
    required_samples: 100,
    model_info: {
      name: "RandomForest v1.0",
      baseline_comparison: "기준선 대비 MAE 1.6석 개선"
    },
    recent_arrivals: [
      { vehicle_id: "서울74사 2091", time: "14:22", before_seats: 9, arrival_seats: 3 },
      { vehicle_id: "서울74사 1234", time: "14:02", before_seats: 11, arrival_seats: 4 },
      { vehicle_id: "서울74사 5812", time: "13:42", before_seats: 13, arrival_seats: 7 }
    ],
    updated_at: "14:40:12"
  }
};

// Durum Yönetimi
const state = {
  scenario: "pending",
  selectedStop: "합정역",
  lastPayload: null
};

// SVG İkonlar
const ICONS = {
  pending: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  ready: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  danger: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
};

// =========================================================================
// 3. API SERVİS KATMANI
// =========================================================================
async function fetchPredictionData(stopName, scenarioKey) {
  if (CONFIG.USE_MOCK_API) {
    await new Promise((resolve) => setTimeout(resolve, CONFIG.MOCK_DELAY_MS));

    if (scenarioKey === "error") {
      throw new Error("백엔드 API 서버(localhost:8000)에 연결할 수 없습니다.");
    }

    const base = structuredClone(MOCK_SCENARIOS[scenarioKey]);
    base.target_stop = stopName;
    base.updated_at = new Date().toTimeString().slice(0, 8);
    return base;
  }

  // Gerçek API çağrısı
  const url = `${CONFIG.API_BASE_URL}?stop=${encodeURIComponent(stopName)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API 오류 (${response.status})`);
  }
  return await response.json();
}

// =========================================================================
// 4. YARDIMCI FONKSİYONLAR
// =========================================================================
function getOccupancyMeta(seats, total) {
  const ratio = seats / total;
  if (seats <= 5 || ratio <= 0.15) {
    return { label: "혼잡", className: "danger" };
  }
  if (seats <= 14 || ratio <= 0.35) {
    return { label: "보통", className: "warn" };
  }
  return { label: "여유", className: "safe" };
}

// =========================================================================
// 5. EKRAN RENDER FONKSİYONU
// =========================================================================
function renderData(data) {
  state.lastPayload = data;

  // Üst çubuk canlılık durumu
  document.getElementById("live-dot").classList.remove("error");
  document.getElementById("connection-label").textContent = CONFIG.USE_MOCK_API
    ? "실시간 모의 데이터"
    : "실시간 API 연결됨";
  document.getElementById("updated-at").textContent = data.updated_at;

  // Durak ve rota
  document.getElementById("eta-badge").textContent = `약 ${data.eta_minutes}분 후 도착`;
  document.getElementById("vehicle-id").textContent = `차량번호: ${data.vehicle_id}`;
  document.getElementById("total-seats-chip").textContent = `총 정원 ${data.total_seats}석`;
  document.getElementById("prev-stop-label").textContent = STOP_PREV_MAP[data.target_stop] || "이전 정류장";
  document.getElementById("target-stop-label").textContent = data.target_stop;

  // Mevcut koltuk kartı
  const currentMeta = getOccupancyMeta(data.current_seats, data.total_seats);
  const currentPct = Math.min(100, Math.round((data.current_seats / data.total_seats) * 100));

  document.getElementById("current-seats").textContent = data.current_seats;
  const currentBadge = document.getElementById("current-level-badge");
  currentBadge.textContent = currentMeta.label;
  currentBadge.className = `level-badge ${currentMeta.className}`;

  const currentFill = document.getElementById("current-capacity-fill");
  currentFill.style.width = `${currentPct}%`;
  currentFill.className = `capacity-fill ${currentMeta.className}`;

  // Tahmin kartı ve Durum paneli
  const predictedEl = document.getElementById("predicted-seats");
  const predictedUnit = document.getElementById("predicted-unit");
  const predictedDelta = document.getElementById("predicted-delta");
  const predictedFill = document.getElementById("predicted-capacity-fill");
  const predictedSub = document.getElementById("predicted-subtext");

  const statusPanel = document.getElementById("status-panel");
  const statusIcon = document.getElementById("status-icon");
  const statusEyebrow = document.getElementById("status-eyebrow");
  const statusTitle = document.getElementById("status-title");
  const statusMessage = document.getElementById("status-message");
  const collectionWidget = document.getElementById("collection-widget");
  const modelMetrics = document.getElementById("model-metrics");
  const retryBtn = document.getElementById("btn-retry");

  retryBtn.hidden = true;

  if (data.prediction_status === "READY" && data.predicted_seats !== null) {
    const predMeta = getOccupancyMeta(data.predicted_seats, data.total_seats);
    const predPct = Math.min(100, Math.round((data.predicted_seats / data.total_seats) * 100));
    const diff = data.predicted_seats - data.current_seats;

    predictedEl.textContent = data.predicted_seats;
    predictedEl.classList.remove("pending-text");
    predictedUnit.hidden = false;

    predictedDelta.textContent = diff <= 0 ? `현재 대비 ${diff}석` : `현재 대비 +${diff}석`;
    predictedDelta.className = `delta-badge ${predMeta.className === "danger" ? "danger" : "down"}`;

    predictedFill.style.width = `${predPct}%`;
    predictedFill.className = `capacity-fill ${predMeta.className}`;
    predictedSub.textContent = `${data.target_stop} 도착 시점 예측`;

    // Durum paneli (Rahat vs Kalabalık uyarısı)
    const isCrowded = predMeta.className === "danger";
    statusPanel.className = `panel status-panel ${isCrowded ? "danger" : "ready"}`;
    statusIcon.innerHTML = isCrowded ? ICONS.danger : ICONS.ready;
    statusEyebrow.textContent = isCrowded ? "CROWDING ALERT" : "PREDICTION READY";
    statusTitle.textContent = isCrowded ? "만석 주의 · 탑승 혼잡 예상" : "예측 완료 · 여유 탑승 예상";
    statusMessage.textContent = isCrowded
      ? `${data.target_stop} 도착 시 잔여 좌석이 약 ${data.predicted_seats}석으로 줄어들 전망입니다. 다음 차량 이용을 고려해 주세요.`
      : `${data.target_stop} 도착 시 약 ${data.predicted_seats}석이 남을 것으로 예측되어 안정적인 탑승이 가능합니다.`;

    collectionWidget.hidden = true;
    modelMetrics.hidden = false;
    document.getElementById("model-name").textContent = data.model_info?.name || "scikit-learn";
    document.getElementById("baseline-compare").textContent = data.model_info?.baseline_comparison || "-";
  } else {
    // PENDING (예측 보류)
    predictedEl.textContent = "예측 보류";
    predictedEl.classList.add("pending-text");
    predictedUnit.hidden = true;

    predictedDelta.textContent = "수집 중";
    predictedDelta.className = "delta-badge";

    predictedFill.style.width = "100%";
    predictedFill.className = "capacity-fill muted";
    predictedSub.textContent = `기준선(현재 좌석): ${data.current_seats}석`;

    statusPanel.className = "panel status-panel pending";
    statusIcon.innerHTML = ICONS.pending;
    statusEyebrow.textContent = "PREDICTION PENDING";
    statusTitle.textContent = "예측 보류 이유";
    statusMessage.textContent = data.pending_reason || "예측 모델을 준비하고 있습니다.";

    const ratio = Math.min(100, Math.round((data.collected_samples / data.required_samples) * 100));
    collectionWidget.hidden = false;
    modelMetrics.hidden = true;
    document.getElementById("collection-count").textContent =
      `${data.collected_samples} / ${data.required_samples}건 (${ratio}%)`;
    document.getElementById("collection-bar").style.width = `${ratio}%`;
  }

  // Son araç varış kayıtları listesi
  renderLogs(data.recent_arrivals || []);

  // JSON önizleme güncelle
  document.getElementById("json-preview").textContent = JSON.stringify(data, null, 2);
}

function renderLogs(logs) {
  const container = document.getElementById("recent-logs");
  container.innerHTML = logs
    .map((item) => {
      const diff = item.arrival_seats - item.before_seats;
      const diffStr = diff > 0 ? `+${diff}` : `${diff}`;
      return `
        <div class="log-row">
          <div>
            <span class="log-vehicle">${item.vehicle_id}</span>
            <span class="log-time">${item.time} 도착 기록</span>
          </div>
          <div>
            <span class="log-seats">${item.before_seats}석 → ${item.arrival_seats}석</span>
            <span class="log-diff">(${diffStr})</span>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderError(error) {
  state.lastPayload = { error: true, message: error.message };

  document.getElementById("live-dot").classList.add("error");
  document.getElementById("connection-label").textContent = "연결 끊김";

  const statusPanel = document.getElementById("status-panel");
  statusPanel.className = "panel status-panel danger";
  document.getElementById("status-icon").innerHTML = ICONS.danger;
  document.getElementById("status-eyebrow").textContent = "CONNECTION ERROR";
  document.getElementById("status-title").textContent = "API 서버 응답 없음";
  document.getElementById("status-message").textContent = error.message;

  document.getElementById("collection-widget").hidden = true;
  document.getElementById("model-metrics").hidden = true;
  document.getElementById("btn-retry").hidden = false;

  document.getElementById("json-preview").textContent = JSON.stringify(state.lastPayload, null, 2);
}

// =========================================================================
// 6. KULLANICI ETKİLEŞİMLERİ VE BAŞLATMA
// =========================================================================
async function refreshDashboard() {
  const dashboard = document.getElementById("dashboard-content");
  const refreshBtn = document.getElementById("btn-refresh");

  dashboard.classList.add("loading");
  refreshBtn.classList.add("spinning");

  try {
    const data = await fetchPredictionData(state.selectedStop, state.scenario);
    renderData(data);
  } catch (err) {
    renderError(err);
  } finally {
    dashboard.classList.remove("loading");
    refreshBtn.classList.remove("spinning");
  }
}

// Durak seçimi
document.getElementById("stop-select").addEventListener("change", (e) => {
  state.selectedStop = e.target.value;
  refreshDashboard();
});

// Yenileme ve yeniden deneme butonları
document.getElementById("btn-refresh").addEventListener("click", refreshDashboard);
document.getElementById("btn-retry").addEventListener("click", () => {
  state.scenario = "pending";
  updateActiveScenarioButton("pending");
  refreshDashboard();
});

// Senaryo değiştirme butonları
function updateActiveScenarioButton(key) {
  document.querySelectorAll(".scenario-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.scenario === key);
  });
}

document.querySelectorAll(".scenario-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.scenario = btn.dataset.scenario;
    updateActiveScenarioButton(state.scenario);
    refreshDashboard();
  });
});

// API JSON önizleme çekmecesi
const jsonDrawer = document.getElementById("json-drawer");
document.getElementById("btn-toggle-json").addEventListener("click", (e) => {
  const isHidden = jsonDrawer.hidden;
  jsonDrawer.hidden = !isHidden;
  e.target.textContent = isHidden ? "API JSON 닫기" : "API JSON 보기";
});

document.getElementById("btn-copy-json").addEventListener("click", async (e) => {
  if (!state.lastPayload) return;
  await navigator.clipboard.writeText(JSON.stringify(state.lastPayload, null, 2));
  const original = e.target.textContent;
  e.target.textContent = "복사됨!";
  setTimeout(() => (e.target.textContent = original), 1200);
});

// Karanlık / Aydınlık Mod
const htmlEl = document.documentElement;
document.getElementById("btn-theme").addEventListener("click", () => {
  const next = htmlEl.getAttribute("data-theme") === "dark" ? "light" : "dark";
  htmlEl.setAttribute("data-theme", next);
  localStorage.setItem("bus6002-theme", next);
});

const savedTheme = localStorage.getItem("bus6002-theme");
if (savedTheme) htmlEl.setAttribute("data-theme", savedTheme);

// İlk yükleme
refreshDashboard();
