/**
 * ==========================================================================
 * AI 영화 큐레이터 - 프론트엔드 인터랙션 스크립트 (app.js)
 * ==========================================================================
 */

document.addEventListener("DOMContentLoaded", () => {
    // 1. 주요 DOM 엘리먼트 참조
    const form = document.getElementById("recommendForm");
    const genreInput = document.getElementById("genre");
    const keywordInput = document.getElementById("keyword");
    const actorInput = document.getElementById("actor");
    const runtimeInput = document.getElementById("runtime");
    const submitBtn = document.getElementById("submitBtn");

    const loadingSection = document.getElementById("loadingSection");
    const errorSection = document.getElementById("errorSection");
    const errorMessage = document.getElementById("errorMessage");
    const resultSection = document.getElementById("resultSection");

    // 2. 결과 카드 내부 엘리먼트 참조
    const moviePoster = document.getElementById("moviePoster");
    const movieTitle = document.getElementById("movieTitle");
    const movieOriginalTitle = document.getElementById("movieOriginalTitle");
    const movieYear = document.getElementById("movieYear");
    const movieGenre = document.getElementById("movieGenre");
    const movieRuntime = document.getElementById("movieRuntime");
    const movieReason = document.getElementById("movieReason");
    const moviePlot = document.getElementById("moviePlot");
    const movieDirector = document.getElementById("movieDirector");
    const movieCast = document.getElementById("movieCast");
    const ottPlatforms = document.getElementById("ottPlatforms");

    // 3. 폼 제출 이벤트 핸들러
    form.addEventListener("submit", async (e) => {
        e.preventDefault(); // 새로고침 방지

        // 입력값 수집 및 공백 제거
        const genre = genreInput.value.trim();
        const originInput = document.querySelector('input[name="origin"]:checked');
        const origin = originInput ? originInput.value : "";
        const keyword = keywordInput.value.trim();
        const actor = actorInput.value.trim();
        const runtime = runtimeInput.value.trim();

        // 4. 프론트엔드 유효성 검사
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

        // 5. 로딩 UI 상태로 전환
        setLoadingState(true);
        hideError();
        hideResult();

        // 로딩 화면으로 부드럽게 스크롤
        loadingSection.scrollIntoView({ behavior: "smooth", block: "center" });

        try {
            // 6. 백엔드 Flask /recommend 엔드포인트 비동기 호출
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
                    runtime: runtime
                })
            });

            const data = await response.json();

            // 백엔드 에러 응답 처리
            if (!response.ok || !data.success) {
                throw new Error(data.error || "추천 결과를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.");
            }

            // 7. 성공 시 화면에 영화 데이터 렌더링
            renderMovieResult(data.movie);

        } catch (err) {
            console.error("영화 추천 요청 실패:", err);
            showError(err.message || "서버와 통신하는 중 문제가 발생했습니다. 네트워크 상태나 API 키 설정을 확인해 주세요.");
        } finally {
            // 로딩 종료
            setLoadingState(false);
        }
    });

    // 8. 영화 추천 결과 화면 렌더링 함수
    function renderMovieResult(movie) {
        // [좌측 Split-view] 포스터 이미지
        moviePoster.src = movie.poster_url || "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=600&q=80";
        moviePoster.alt = `${movie.title} 포스터`;

        // [우측 Split-view] 메타 정보 및 텍스트 정보
        movieTitle.textContent = movie.title || "제목 정보 없음";
        movieOriginalTitle.textContent = movie.original_title ? `(${movie.original_title})` : "";
        movieYear.textContent = `📅 ${movie.release_year || "개봉연도 정보 없음"}`;
        movieGenre.textContent = `🎭 ${movie.genre || "장르 정보 없음"}`;
        movieRuntime.textContent = `⏱️ ${movie.runtime || "상영시간 정보 없음"}`;
        
        movieReason.textContent = movie.recommendation_reason || "사용자 맞춤 추천작입니다.";
        moviePlot.textContent = movie.plot || "줄거리 정보가 제공되지 않았습니다.";
        movieDirector.textContent = movie.director || "정보 없음";
        movieCast.textContent = movie.cast || "정보 없음";

        // OTT 배지 목록 렌더링
        ottPlatforms.innerHTML = "";
        const ottList = Array.isArray(movie.ott_platforms) && movie.ott_platforms.length > 0
            ? movie.ott_platforms
            : ["극장 / 개별 VOD 구매"];

        ottList.forEach(ott => {
            const badge = document.createElement("span");
            badge.className = "ott-badge";
            badge.setAttribute("data-ott", ott);
            badge.innerHTML = `📺 <span>${ott}</span>`;
            ottPlatforms.appendChild(badge);
        });

        // 결과 카드 노출 및 스크롤
        resultSection.classList.remove("hidden");
        resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    // 상태 제어 헬퍼 함수들
    function setLoadingState(isLoading) {
        if (isLoading) {
            submitBtn.disabled = true;
            submitBtn.querySelector(".btn-text").textContent = "AI가 영화를 분석 및 검색 중입니다...";
            loadingSection.classList.remove("hidden");
        } else {
            submitBtn.disabled = false;
            submitBtn.querySelector(".btn-text").textContent = "AI 맞춤 영화 추천받기";
            loadingSection.classList.add("hidden");
        }
    }

    function showError(message) {
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
