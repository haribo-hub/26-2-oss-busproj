// ==========================================
// 1. AYARLAR (İleride B'nin API'si gelince burası değişecek)
// ==========================================
const CONFIG = {
  USE_MOCK_API: true, // Gerçek API hazır olunca false yap
  API_URL: "http://localhost:8000/api/bus/6002" // B'nin vereceği gerçek adres
};

// ==========================================
// 2. ÖRNEK (SANAL) API VERİLERİ
// ==========================================
const MOCK_RESPONSES = {
  // Senaryo 1: Henüz yeterli veri yok, tahmin beklemede
  pending: {
    bus_number: "6002",
    vehicle_id: "서울74사1234",
    target_stop: "합정역",
    current_seats: 16,
    prediction_status: "PENDING",
    predicted_seats: null,
    pending_reason: "도착 학습 데이터가 부족합니다. (현재 32건 / 최소 100건 필요)",
    updated_at: "14:35:10"
  },

  // Senaryo 2: B'nin modeli çalıştı ve tahmin sonucu üretti
  ready: {
    bus_number: "6002",
    vehicle_id: "서울74사1234",
    target_stop: "합정역",
    current_seats: 16,
    prediction_status: "READY",
    predicted_seats: 11,
    pending_reason: null,
    updated_at: "14:36:00"
  }
};

// ==========================================
// 3. VERİ ÇEKME FONKSİYONU (API Katmanı)
// ==========================================
async function fetchBusData(mockType = "pending") {
  if (CONFIG.USE_MOCK_API) {
    // Gerçek API gecikmesini taklit etmek için kısa bekleme
    return new Promise((resolve) => {
      setTimeout(() => resolve(MOCK_RESPONSES[mockType]), 150);
    });
  }

  // Gerçek API'ye bağlanıldığında çalışacak kısım
  const response = await fetch(CONFIG.API_URL);
  if (!response.ok) {
    throw new Error("API 응답 오류");
  }
  return await response.json();
}

// ==========================================
// 4. EKRANI GÜNCELLEME (UI Render)
// ==========================================
function renderBusStatus(data) {
  document.getElementById("target-stop").textContent = data.target_stop;
  document.getElementById("vehicle-id").textContent = `차량번호: ${data.vehicle_id}`;
  document.getElementById("updated-at").textContent = `업데이트: ${data.updated_at}`;
  document.getElementById("current-seats").textContent = `${data.current_seats}석`;

  const predictedEl = document.getElementById("predicted-seats");
  const statusBox = document.getElementById("status-box");
  const statusTitle = document.getElementById("status-title");
  const statusMessage = document.getElementById("status-message");

  if (data.prediction_status === "READY" && data.predicted_seats !== null) {
    // Tahmin hazır durumu
    predictedEl.textContent = `${data.predicted_seats}석`;
    predictedEl.classList.remove("muted");

    statusBox.className = "status-box ready";
    statusTitle.textContent = "예측 완료";
    statusMessage.textContent = `목표 정류장(${data.target_stop}) 도착 시 약 ${data.predicted_seats}석 남을 것으로 예상됩니다.`;
  } else {
    // Tahmin bekleme (보류) durumu
    predictedEl.textContent = "보류 중";
    predictedEl.classList.add("muted");

    statusBox.className = "status-box pending";
    statusTitle.textContent = "예측 보류 이유";
    statusMessage.textContent = data.pending_reason || "예측 데이터를 준비 중입니다.";
  }
}

// ==========================================
// 5. BAŞLATMA VE TEST BUTONLARI
// ==========================================
async function loadDashboard(mockType = "pending") {
  try {
    const data = await fetchBusData(mockType);
    renderBusStatus(data);
  } catch (error) {
    document.getElementById("status-box").className = "status-box pending";
    document.getElementById("status-title").textContent = "연결 오류";
    document.getElementById("status-message").textContent = "서버에서 버스 정보를 가져오지 못했습니다.";
  }
}

// Alt kısımdaki test butonlarını bağla
const btnPending = document.getElementById("btn-mock-pending");
const btnReady = document.getElementById("btn-mock-ready");

btnPending.addEventListener("click", () => {
  btnPending.classList.add("active");
  btnReady.classList.remove("active");
  loadDashboard("pending");
});

btnReady.addEventListener("click", () => {
  btnReady.classList.add("active");
  btnPending.classList.remove("active");
  loadDashboard("ready");
});

// Sayfa ilk açıldığında varsayılan olarak 'pending' (beklemede) durumunu göster
loadDashboard("pending");