/**
 * ==========================================================================
 * AI 영화 큐레이터 - 프론트엔드 인터랙션 스크립트 (좌우 2단 대시보드 레이아웃 지원)
 * ==========================================================================
 */

document.addEventListener("DOMContentLoaded", () => {
    // 1. 주요 DOM 엘리먼트 참조
    const form = document.getElementById("recommendForm");
    const genreInput = document.getElementById("genre");
    const keywordInput = document.getElementById("keyword");
    const actorInput = document.getElementById("actor");
    const runtimeInput = document.getElementById("runtime");
    const startDateInput = document.getElementById("startDate");
    const endDateInput = document.getElementById("endDate");
    const resetDateBtn = document.getElementById("resetDateBtn");
    const presetButtons = document.querySelectorAll(".preset-btn");
    const submitBtn = document.getElementById("submitBtn");

    const emptySection = document.getElementById("emptySection");
    const loadingSection = document.getElementById("loadingSection");
    const errorSection = document.getElementById("errorSection");
    const errorMessage = document.getElementById("errorMessage");
    const resultSection = document.getElementById("resultSection");
    const movieCardsContainer = document.getElementById("movieCardsContainer");
    const pwaInstallBtn = document.getElementById("pwaInstallBtn");

    const DEFAULT_POSTER = "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=600&q=80";

    // 2. 캘린더 빠른 프리셋 선택 버튼 이벤트 제어
    presetButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            presetButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            const preset = btn.getAttribute("data-preset");
            const currentYear = new Date().getFullYear();

            switch (preset) {
                case "all":
                    startDateInput.value = "";
                    endDateInput.value = "";
                    break;
                case "latest":
                    startDateInput.value = `${currentYear - 2}-01-01`;
                    endDateInput.value = `${currentYear}-12-31`;
                    break;
                case "2020s":
                    startDateInput.value = "2020-01-01";
                    endDateInput.value = `${currentYear}-12-31`;
                    break;
                case "2010s":
                    startDateInput.value = "2010-01-01";
                    endDateInput.value = "2019-12-31";
                    break;
                case "2000s":
                    startDateInput.value = "2000-01-01";
                    endDateInput.value = "2009-12-31";
                    break;
                case "classic":
                    startDateInput.value = "1930-01-01";
                    endDateInput.value = "1999-12-31";
                    break;
            }
        });
    });

    [startDateInput, endDateInput].forEach(input => {
        input.addEventListener("change", () => {
            presetButtons.forEach(b => b.classList.remove("active"));
        });
    });

    resetDateBtn.addEventListener("click", () => {
        startDateInput.value = "";
        endDateInput.value = "";
        presetButtons.forEach(b => b.classList.remove("active"));
        const allBtn = document.querySelector('.preset-btn[data-preset="all"]');
        if (allBtn) allBtn.classList.add("active");
    });

    // 3. PWA 서비스 워커 등록 및 앱 설치 이벤트
    let deferredPrompt = null;

    if ("serviceWorker" in navigator) {
        window.addEventListener("load", () => {
            navigator.serviceWorker.register("/sw.js")
                .then((reg) => console.log("PWA Service Worker 등록 성공:", reg.scope))
                .catch((err) => console.log("PWA Service Worker 등록 실패:", err));
        });
    }

    window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        deferredPrompt = e;
        if (pwaInstallBtn) pwaInstallBtn.classList.remove("hidden");
    });

    if (pwaInstallBtn) {
        pwaInstallBtn.addEventListener("click", async () => {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log(`사용자 설치 선택: ${outcome}`);
            deferredPrompt = null;
            pwaInstallBtn.classList.add("hidden");
        });
    }

    window.addEventListener("appinstalled", () => {
        if (pwaInstallBtn) pwaInstallBtn.classList.add("hidden");
    });

    // 4. 폼 제출 이벤트 핸들러
    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const genre = genreInput.value.trim();
        const originInput = document.querySelector('input[name="origin"]:checked');
        const origin = originInput ? originInput.value : "";
        const keyword = keywordInput.value.trim();
        const actor = actorInput.value.trim();
        const runtime = runtimeInput.value.trim();
        const startDate = startDateInput.value.trim();
        const endDate = endDateInput.value.trim();

        if (!genre) {
            alert("영화 장르를 선택해 주세요!");
            genreInput.focus();
            return;
        }

        if (!origin) {
            alert("국내영화 또는 해외영화를 선택해 주세요!");
            return;
        }

        if (!keyword) {
            alert("원하는 영화의 스토리나 분위기 키워드를 입력해 주세요!");
            keywordInput.focus();
            return;
        }

        if (startDate && endDate && startDate > endDate) {
            alert("시작일이 종료일보다 늦을 수 없습니다. 기간을 다시 확인해 주세요!");
            startDateInput.focus();
            return;
        }

        // 로딩 시작 (대기 카드 숨기고 로딩 스피너 표시)
        setLoadingState(true);
        if (emptySection) emptySection.classList.add("hidden");
        hideError();
        hideResult();

        // 모바일/태블릿 등 1열 화면일 때는 우측 로딩 영역으로 부드럽게 스크롤
        if (window.innerWidth <= 1024) {
            loadingSection.scrollIntoView({ behavior: "smooth", block: "start" });
        }

        try {
            const response = await fetch("/recommend", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    genre: genre,
                    origin: origin,
                    keyword: keyword,
                    actor: actor,
                    runtime: runtime,
                    start_date: startDate,
                    end_date: endDate
                })
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.error || "추천 결과를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.");
            }

            renderMoviesResult(data.movies || []);

        } catch (err) {
            console.error("영화 추천 요청 실패:", err);
            showError(err.message || "서버와 통신하는 중 문제가 발생했습니다. 네트워크 상태나 API 키 설정을 확인해 주세요.");
        } finally {
            setLoadingState(false);
        }
    });

    // 5. 각 OTT 플랫폼별 실시간 검색/감상 링크 생성 헬퍼 함수
    function getOttSearchUrl(platform, movieTitle) {
        const encodedTitle = encodeURIComponent(movieTitle);
        const name = (platform || "").toLowerCase();

        if (name.includes("넷플릭스") || name.includes("netflix")) {
            return `https://www.netflix.com/search?q=${encodedTitle}`;
        } else if (name.includes("티빙") || name.includes("tving")) {
            return `https://www.tving.com/search?keyword=${encodedTitle}`;
        } else if (name.includes("왓챠") || name.includes("watcha")) {
            return `https://watcha.com/search?query=${encodedTitle}`;
        } else if (name.includes("웨이브") || name.includes("wavve")) {
            return `https://www.wavve.com/search?searchWord=${encodedTitle}`;
        } else if (name.includes("디즈니") || name.includes("disney")) {
            return `https://www.disneyplus.com/search?q=${encodedTitle}`;
        } else if (name.includes("쿠팡플레이") || name.includes("coupang")) {
            return `https://www.coupangplay.com/search?q=${encodedTitle}`;
        } else if (name.includes("애플") || name.includes("apple")) {
            return `https://tv.apple.com/kr/search?term=${encodedTitle}`;
        } else if (name.includes("시리즈온") || name.includes("네이버")) {
            return `https://serieson.naver.com/v3/search?query=${encodedTitle}`;
        } else {
            return `https://search.naver.com/search.naver?query=${encodeURIComponent(movieTitle + ' 영화 보러가기')}`;
        }
    }

    // 6. 3편의 영화 카드를 동적으로 생성하여 렌더링하는 함수
    function renderMoviesResult(movies) {
        movieCardsContainer.innerHTML = "";

        if (!movies || movies.length === 0) {
            showError("조건에 맞는 영화를 찾지 못했습니다. 조건을 조금 더 넓게 설정해 보세요.");
            return;
        }

        const rankBadges = [
            { icon: "🥇", label: "TOP 1 추천작", class: "rank-1" },
            { icon: "🥈", label: "TOP 2 추천작", class: "rank-2" },
            { icon: "🥉", label: "TOP 3 추천작", class: "rank-3" }
        ];

        movies.forEach((movie, index) => {
            const rankInfo = rankBadges[index] || { icon: "🎬", label: `추천 ${index + 1}`, class: "rank-default" };

            const card = document.createElement("div");
            card.className = "card result-card";

            const ottInfo = movie.ott_info || {};
            const streamingList = Array.isArray(ottInfo.streaming) ? ottInfo.streaming : [];
            const rentList = Array.isArray(ottInfo.rent_buy) ? ottInfo.rent_buy : [];
            const kinolightsUrl = ottInfo.kinolights_url || `https://m.kinolights.com/search?keyword=${encodeURIComponent(movie.title)}`;
            const justwatchUrl = ottInfo.justwatch_url || `https://www.justwatch.com/kr/%EA%B2%80%EC%83%89?q=${encodeURIComponent(movie.title)}`;

            // 정액제 스트리밍 배지 HTML
            let streamingBadgesHtml = "";
            if (streamingList.length > 0) {
                streamingBadgesHtml = streamingList.map(platform => {
                    const url = getOttSearchUrl(platform, movie.title);
                    return `
                        <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="ott-badge ott-link ott-streaming" data-ott="${escapeHtml(platform)}" title="${escapeHtml(movie.title)} 스트리밍 감상 바로가기">
                            <span>✅ ${escapeHtml(platform)}</span>
                            <span class="ott-link-icon">↗</span>
                        </a>
                    `;
                }).join("");
            } else {
                streamingBadgesHtml = `<span class="ott-no-service">현재 월정액 스트리밍 서비스 미제공 (개별 구매/대여 전용)</span>`;
            }

            // 대여/구매 배지 HTML
            let rentBadgesHtml = "";
            if (rentList.length > 0) {
                rentBadgesHtml = rentList.map(platform => {
                    const url = getOttSearchUrl(platform, movie.title);
                    return `
                        <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="ott-badge ott-link ott-rent" data-ott="${escapeHtml(platform)}" title="${escapeHtml(movie.title)} 대여/구매 바로가기">
                            <span>💳 ${escapeHtml(platform)} (대여/구매)</span>
                            <span class="ott-link-icon">↗</span>
                        </a>
                    `;
                }).join("");
            }

            // 제작국가 국기 이모지 보조 표시
            const countryText = movie.production_country || "정보 없음";
            let countryIcon = "🌐";
            if (countryText.includes("한국") || countryText.includes("대한민국")) countryIcon = "🇰🇷";
            else if (countryText.includes("미국")) countryIcon = "🇺🇸";
            else if (countryText.includes("영국")) countryIcon = "🇬🇧";
            else if (countryText.includes("일본")) countryIcon = "🇯🇵";
            else if (countryText.includes("프랑스")) countryIcon = "🇫🇷";
            else if (countryText.includes("독일")) countryIcon = "🇩🇪";

            // 개별 영화 카드 조립
            card.innerHTML = `
                <div class="split-view">
                    <!-- 좌측: 포스터 이미지 -->
                    <div class="split-left">
                        <div class="poster-container">
                            <img src="${escapeHtml(movie.poster_url || DEFAULT_POSTER)}" 
                                 alt="${escapeHtml(movie.title)} 포스터" 
                                 class="poster-img" 
                                 onerror="this.src='${DEFAULT_POSTER}';">
                            <div class="poster-badge ${rankInfo.class}">${rankInfo.icon} ${rankInfo.label}</div>
                        </div>
                    </div>

                    <!-- 우측: 상세 정보 -->
                    <div class="split-right">
                        <div class="movie-header">
                            <h2 class="movie-title">${escapeHtml(movie.title || "제목 미상")}</h2>
                            ${movie.original_title ? `<p class="movie-original-title">(${escapeHtml(movie.original_title)})</p>` : ""}
                        </div>

                        <!-- 메타 정보 배지 (제작 국가 & 개봉연도) -->
                        <div class="meta-badges">
                            <span class="badge highlight-country">${countryIcon} ${escapeHtml(countryText)}</span>
                            <span class="badge">📅 ${escapeHtml(movie.release_year || "개봉연도 미상")}</span>
                            <span class="badge">🎭 ${escapeHtml(movie.genre || "장르 정보 없음")}</span>
                            <span class="badge">⏱️ ${escapeHtml(movie.runtime || "러닝타임 미상")}</span>
                        </div>

                        <!-- AI 추천 이유 -->
                        <div class="info-block highlight-box">
                            <h4 class="info-label">💡 AI 추천 이유</h4>
                            <p class="info-text reason-text">${escapeHtml(movie.recommendation_reason || "조건에 부합하는 작품입니다.")}</p>
                        </div>

                        <!-- 줄거리 요약 -->
                        <div class="info-block">
                            <h4 class="info-label">📖 줄거리 요약</h4>
                            <p class="info-text">${escapeHtml(movie.plot || "줄거리 정보가 제공되지 않았습니다.")}</p>
                        </div>

                        <!-- 감독 및 출연진 -->
                        <div class="info-block">
                            <h4 class="info-label">👥 감독 & 출연진</h4>
                            <p class="info-text">
                                <strong>감독:</strong> ${escapeHtml(movie.director || "정보 없음")}<br>
                                <strong>출연:</strong> ${escapeHtml(movie.cast || "정보 없음")}
                            </p>
                        </div>

                        <!-- 정밀 실시간 OTT 정보 -->
                        <div class="info-block ott-section-block">
                            <h4 class="info-label">
                                📺 현재 감상 가능한 플랫폼
                            </h4>

                            <!-- 실제 스트리밍 중인 플랫폼 -->
                            <div class="ott-category">
                                <span class="ott-category-label">월정액 스트리밍:</span>
                                <div class="ott-tags">
                                    ${streamingBadgesHtml}
                                </div>
                            </div>

                            <!-- 대여/구매 플랫폼 (존재할 경우) -->
                            ${rentList.length > 0 ? `
                            <div class="ott-category">
                                <span class="ott-category-label">개별 대여/구매:</span>
                                <div class="ott-tags">
                                    ${rentBadgesHtml}
                                </div>
                            </div>
                            ` : ""}

                            <!-- 100% 실시간 공식 검증 통합 검색 버튼 -->
                            <div class="ott-verify-actions">
                                <a href="${escapeHtml(kinolightsUrl)}" target="_blank" rel="noopener noreferrer" class="verify-btn kinolights-btn" title="키노라이츠에서 모든 OTT 가격 및 서비스 현황 실시간 조회">
                                    🔍 키노라이츠에서 실시간 OTT 전체 확인 ↗
                                </a>
                                <a href="${escapeHtml(justwatchUrl)}" target="_blank" rel="noopener noreferrer" class="verify-btn justwatch-btn" title="저스트와치에서 실시간 스트리밍 현황 확인">
                                    🎬 저스트와치에서 확인 ↗
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            movieCardsContainer.appendChild(card);
        });

        // 대기 화면 숨기고 결과 영역 노출
        if (emptySection) emptySection.classList.add("hidden");
        resultSection.classList.remove("hidden");

        // 모바일/태블릿 화면일 때 결과 영역으로 스크롤 이동
        if (window.innerWidth <= 1024) {
            resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }

    function escapeHtml(text) {
        if (!text) return "";
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function setLoadingState(isLoading) {
        if (isLoading) {
            submitBtn.disabled = true;
            submitBtn.querySelector(".btn-text").textContent = "AI가 영화 3편을 정밀 큐레이션 중...";
            loadingSection.classList.remove("hidden");
        } else {
            submitBtn.disabled = false;
            submitBtn.querySelector(".btn-text").textContent = "AI 맞춤 영화 3편 추천받기";
            loadingSection.classList.add("hidden");
        }
    }

    function showError(message) {
        if (emptySection) emptySection.classList.add("hidden");
        errorMessage.textContent = message;
        errorSection.classList.remove("hidden");
        errorSection.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    function hideError() {
        errorSection.classList.add("hidden");
        errorMessage.textContent = "";
    }

    function hideResult() {
        resultSection.classList.add("hidden");
    }
});
