import os
import json
import re
import logging
import requests
from dotenv import load_dotenv
from flask import Flask, render_template, request, jsonify
from google import genai
from google.genai import types

# 환경변수 로드 (.env 파일에서 API 키 읽어오기)
load_dotenv()

# 로깅 설정
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__)

# 기본 대체 포스터 이미지 (검색 실패나 이미지 누락 시 사용)
DEFAULT_POSTER = "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=600&q=80"


def get_gemini_client():
    """Gemini API 클라이언트를 초기화합니다."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or api_key == "your_gemini_api_key_here":
        return None
    return genai.Client(api_key=api_key)


def get_serper_key():
    """Serper API 키를 가져옵니다."""
    api_key = os.getenv("SERPER_API_KEY")
    if not api_key or api_key == "your_serper_api_key_here":
        return None
    return api_key


def search_poster_serper(movie_title, release_year=""):
    """Serper Images API를 사용해 최신 영화 공식 포스터 이미지를 실시간 검색합니다."""
    serper_key = get_serper_key()
    if not serper_key:
        logger.warning("SERPER_API_KEY 미설정: 기본 포스터 이미지를 사용합니다.")
        return DEFAULT_POSTER

    url = "https://google.serper.dev/images"
    query = f"{movie_title} {release_year} 영화 포스터 poster".strip()
    headers = {
        "X-API-KEY": serper_key,
        "Content-Type": "application/json"
    }
    payload = {
        "q": query,
        "gl": "kr",
        "hl": "ko",
        "num": 5
    }

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=5)
        if response.status_code == 200:
            data = response.json()
            images = data.get("images", [])
            if images and len(images) > 0:
                image_url = images[0].get("imageUrl")
                if image_url:
                    return image_url
    except Exception as e:
        logger.error(f"Serper 포스터 이미지 검색 실패: {e}")

    return DEFAULT_POSTER


def search_ott_serper(movie_title):
    """Serper Search API를 사용해 영화를 감상할 수 있는 국내 스트리밍 OTT 플랫폼을 실시간 검색합니다."""
    serper_key = get_serper_key()
    detected_platforms = set()
    known_platforms = ["넷플릭스", "티빙", "왓챠", "웨이브", "디즈니+", "디즈니플러스", "쿠팡플레이", "애플TV", "시리즈온"]

    if not serper_key:
        return []

    url = "https://google.serper.dev/search"
    query = f"{movie_title} 영화 스트리밍 OTT 보러가기"
    headers = {
        "X-API-KEY": serper_key,
        "Content-Type": "application/json"
    }
    payload = {
        "q": query,
        "gl": "kr",
        "hl": "ko",
        "num": 5
    }

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=5)
        if response.status_code == 200:
            data = response.json()
            text_corpus = ""
            for item in data.get("organic", []):
                text_corpus += f" {item.get('title', '')} {item.get('snippet', '')} "

            for platform in known_platforms:
                if platform in text_corpus:
                    clean_name = "디즈니+" if platform == "디즈니플러스" else platform
                    detected_platforms.add(clean_name)
    except Exception as e:
        logger.error(f"Serper OTT 검색 실패: {e}")

    return list(detected_platforms)


@app.route("/")
def index():
    """메인 페이지 HTML 렌더링"""
    return render_template("index.html")


@app.route("/recommend", methods=["POST"])
def recommend():
    """사용자 조건에 맞춰 영화를 추천하고 포스터 및 OTT 정보를 결합하여 반환"""
    data = request.get_json(silent=True) or {}

    genre = data.get("genre", "").strip()
    origin = data.get("origin", "").strip()  # "국내" or "해외"
    keyword = data.get("keyword", "").strip()
    actor = data.get("actor", "").strip()
    runtime = data.get("runtime", "").strip()

    # 1. 백엔드 필수 입력값 유효성 검증
    if not genre:
        return jsonify({"success": False, "error": "영화 장르를 선택해 주세요."}), 400
    if not origin:
        return jsonify({"success": False, "error": "국내영화/해외영화 구분을 선택해 주세요."}), 400
    if not keyword:
        return jsonify({"success": False, "error": "원하는 줄거리나 내용 키워드를 입력해 주세요."}), 400

    # 2. Gemini 클라이언트 준비
    client = get_gemini_client()
    if not client:
        return jsonify({
            "success": False,
            "error": ".env 파일에 올바른 GEMINI_API_KEY가 설정되어 있지 않습니다."
        }), 500

    # 3. AI 프롬프트 구성
    prompt = f"""
당신은 전 세계의 모든 영화를 꿰뚫고 있는 전문 영화 큐레이터입니다.
사용자의 아래 조건에 가장 잘 부합하는 최고의 영화 단 1편을 추천해 주세요.

[사용자 요청 조건]
- 장르: {genre}
- 구분: {origin} 영화
- 원하는 분위기/줄거리 키워드: {keyword}
- 선호하는 배우: {actor if actor else '상관없음'}
- 희망 상영시간: {runtime if runtime else '상관없음'}

반드시 아래 JSON 형식으로만 순수 JSON 문자열을 응답해 주세요:
{{
  "title": "영화 공식 한국어 제목",
  "original_title": "영화 원제",
  "release_year": "개봉연도 (예: 2019)",
  "genre": "세부 장르",
  "director": "감독 이름",
  "cast": "주요 출연진 목록 (쉼표로 구분, 예: 송강호, 이선균, 조여정)",
  "runtime": "상영시간 (예: 132분)",
  "plot": "흥미진진하고 몰입감 넘치는 3~4문장의 상세 줄거리 요약",
  "recommendation_reason": "사용자의 조건에 이 영화를 강력 추천하는 이유 1~2문장",
  "ott_platforms": ["넷플릭스", "티빙"]
}}
"""

    try:
        # 우선 지정 모델: gemini-3.5-flash-lite (호환성 fallback 목록 포함)
        ai_result = None
        target_models = [
            "gemini-3.5-flash-lite",
            "gemini-2.5-flash",
            "gemini-2.0-flash",
            "gemini-1.5-flash"
        ]

        for model_name in target_models:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json"
                    )
                )
                ai_result = response.text
                logger.info(f"성공적으로 {model_name} 모델을 호출했습니다.")
                break
            except Exception as model_err:
                logger.warning(f"{model_name} 호출 실패, 다음 모델을 시도합니다: {model_err}")
                continue

        if not ai_result:
            raise Exception("사용 가능한 Gemini AI 모델을 호출할 수 없습니다.")

        # JSON 파싱
        clean_json_str = ai_result.strip()
        if clean_json_str.startswith("```"):
            clean_json_str = re.sub(r"^```(?:json)?\n", "", clean_json_str)
            clean_json_str = re.sub(r"\n```$", "", clean_json_str)

        movie_info = json.loads(clean_json_str)

        # 4. Serper API 실시간 검색 보강 (포스터 이미지 + OTT 정보)
        movie_title = movie_info.get("title", "")
        release_year = movie_info.get("release_year", "")

        # 포스터 이미지 검색
        poster_url = search_poster_serper(movie_title, release_year)

        # 실시간 OTT 검색 결과와 Gemini 응답 결합 (중복 제거)
        serper_otts = search_ott_serper(movie_title)
        gemini_otts = movie_info.get("ott_platforms", [])
        all_otts = list(set(serper_otts + gemini_otts))
        if not all_otts:
            all_otts = ["극장 / VOD 서비스"]

        # 최종 추천 카드 데이터 구조화
        result = {
            "title": movie_title,
            "original_title": movie_info.get("original_title", ""),
            "release_year": release_year,
            "genre": movie_info.get("genre", genre),
            "director": movie_info.get("director", "정보 없음"),
            "cast": movie_info.get("cast", "정보 없음"),
            "runtime": movie_info.get("runtime", "정보 없음"),
            "plot": movie_info.get("plot", "줄거리 정보가 제공되지 않았습니다."),
            "recommendation_reason": movie_info.get("recommendation_reason", "조건에 꼭 맞는 영화입니다."),
            "poster_url": poster_url,
            "ott_platforms": all_otts
        }

        return jsonify({"success": True, "movie": result})

    except Exception as e:
        logger.error(f"추천 처리 중 오류 발생: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "error": f"영화 추천을 생성하는 중 문제가 발생했습니다: {str(e)}"
        }), 500


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
