import os
import json
import re
import logging
import urllib.parse
import requests
from dotenv import load_dotenv
from flask import Flask, render_template, request, jsonify, send_from_directory, make_response, session, redirect, url_for
from google import genai
from google.genai import types

# 환경변수 로드 (.env 파일에서 API 키 읽어오기)
load_dotenv()

# 로깅 설정
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__)

# 세션 암호화 키 설정
app.secret_key = os.getenv("SECRET_KEY", "movie-curator-super-secret-key-2026")

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


def search_ott_realtime(movie_title):
    """
    대한민국 공식 OTT 스트리밍 데이터(JustWatch & 키노라이츠)를 실시간 검색하여
    실제로 스트리밍 서비스 중인 OTT 목록과 공식 확인 링크를 정확하게 추출합니다.
    """
    encoded_title = urllib.parse.quote(movie_title)
    kinolights_url = f"https://m.kinolights.com/search?keyword={encoded_title}"
    justwatch_url = f"https://www.justwatch.com/kr/%EA%B2%80%EC%83%89?q={encoded_title}"

    serper_key = get_serper_key()
    if not serper_key:
        return {
            "streaming": [],
            "rent_buy": [],
            "kinolights_url": kinolights_url,
            "justwatch_url": justwatch_url
        }

    headers = {
        "X-API-KEY": serper_key,
        "Content-Type": "application/json"
    }

    payload = {
        "q": f'"{movie_title}" site:justwatch.com/kr',
        "gl": "kr",
        "hl": "ko",
        "num": 2
    }

    streaming_platforms = set()
    rent_buy_platforms = set()

    platform_map = {
        "netflix": "넷플릭스",
        "watcha": "왓챠",
        "tving": "티빙",
        "wavve": "웨이브",
        "disney": "디즈니+",
        "coupang": "쿠팡플레이",
        "apple tv": "애플TV+",
        "series on": "시리즈온"
    }

    try:
        response = requests.post("https://google.serper.dev/search", headers=headers, json=payload, timeout=5)
        if response.status_code == 200:
            data = response.json()
            organic = data.get("organic", [])
            if organic:
                item = organic[0]
                snippet = item.get("snippet", "")
                link = item.get("link")
                if link and "justwatch.com/kr" in link:
                    justwatch_url = link

                if "스트리밍" in snippet:
                    streaming_part = snippet.split("스트리밍")[0].lower()
                    for key, name in platform_map.items():
                        if key in streaming_part:
                            streaming_platforms.add(name)

                if "대여" in snippet or "구매" in snippet:
                    for key, name in platform_map.items():
                        if key in snippet.lower() and name not in streaming_platforms:
                            rent_buy_platforms.add(name)

    except Exception as e:
        logger.error(f"JustWatch 실시간 OTT 검색 실패: {e}")

    if not streaming_platforms:
        try:
            payload_kino = {
                "q": f'"{movie_title}" site:kinolights.com',
                "gl": "kr",
                "hl": "ko",
                "num": 2
            }
            resp_kino = requests.post("https://google.serper.dev/search", headers=headers, json=payload_kino, timeout=5)
            if resp_kino.status_code == 200:
                data_kino = resp_kino.json()
                for item in data_kino.get("organic", []):
                    snip = item.get("snippet", "").lower()
                    link = item.get("link", "")
                    if "kinolights.com/title" in link:
                        kinolights_url = link
                    for key, name in platform_map.items():
                        if key in snip and ("스트리밍" in snip or "보러가기" in snip):
                            streaming_platforms.add(name)
        except Exception as e:
            logger.error(f"키노라이츠 실시간 OTT 검색 실패: {e}")

    return {
        "streaming": list(streaming_platforms),
        "rent_buy": list(rent_buy_platforms),
        "kinolights_url": kinolights_url,
        "justwatch_url": justwatch_url
    }


@app.route("/")
def index():
    """메인 라우트: 로그인 여부를 확인하여 잠금 화면(login.html) 또는 메인 앱(index.html) 서빙"""
    if not session.get("authenticated"):
        return render_template("login.html")
    return render_template("index.html")


@app.route("/login", methods=["POST"])
def login():
    """비밀번호 검증 및 세션 인증 부여"""
    data = request.get_json(silent=True) or {}
    password = data.get("password", "").strip()

    correct_password = os.getenv("ACCESS_PASSWORD", "1234")
    if password == correct_password:
        session["authenticated"] = True
        return jsonify({"success": True})
    else:
        return jsonify({"success": False, "error": "비밀번호가 올바르지 않습니다."}), 401


@app.route("/logout")
def logout():
    """로그아웃 처리 후 메인 잠금 화면으로 이동"""
    session.pop("authenticated", None)
    return redirect(url_for("index"))


@app.route("/sw.js")
def service_worker():
    """PWA 서비스 워커 서빙 (사이트 전체 루트 스코프 적용)"""
    response = make_response(send_from_directory(os.path.join(app.root_path, "static"), "sw.js", mimetype="application/javascript"))
    response.headers["Service-Worker-Allowed"] = "/"
    return response


@app.route("/recommend", methods=["POST"])
def recommend():
    """사용자 조건(캘린더 개봉기간 포함)에 맞춰 영화 3편을 추천하고 정밀 OTT 정보를 결합하여 반환"""
    if not session.get("authenticated"):
        return jsonify({"success": False, "error": "인증되지 않은 접근입니다. 먼저 비밀번호로 로그인해 주세요."}), 401

    data = request.get_json(silent=True) or {}

    genre = data.get("genre", "").strip()
    origin = data.get("origin", "").strip()  # "국내" or "해외"
    keyword = data.get("keyword", "").strip()
    actor = data.get("actor", "").strip()
    runtime = data.get("runtime", "").strip()
    start_date = data.get("start_date", "").strip()
    end_date = data.get("end_date", "").strip()

    # 1. 백엔드 필수 입력값 유효성 검증 (원하는 분위기/스토리는 필수, 장르 및 국적은 선택사항)
    if not keyword:
        return jsonify({"success": False, "error": "원하는 스토리나 분위기 키워드를 입력해 주세요."}), 400

    # 2. Gemini 클라이언트 준비
    client = get_gemini_client()
    if not client:
        return jsonify({
            "success": False,
            "error": ".env 파일에 올바른 GEMINI_API_KEY가 설정되어 있지 않습니다."
        }), 500

    # 3. 국내 / 해외 / 전체 구분 필터링 룰 설정
    if origin == "해외":
        origin_text = "해외 영화 (외화)"
        origin_strict_rule = """
[🚨 절대 규칙 1: 100% 순수 해외 영화만 추천할 것 (국내/한국 작품 엄격 배제)]
- 추천하는 3편 모두 반드시 미국(할리우드), 영국, 프랑스, 일본, 독일 등 '외국'에서 제작된 순수 해외 영화(외화)여야 합니다.
- 한국(대한민국) 영화, 한국 감독/제작사 영화, 한국어가 주 언어인 영화, K-콘텐츠는 단 1편도 포함해서는 안 됩니다. (절대 금지)

[🚨 절대 규칙 2: 오직 '단편/장편 영화(Feature Film)'만 추천할 것 (드라마 배제)]
- TV 시리즈, 넷플릭스/디즈니+ 오리지널 드라마, 시즌제 드라마, 미니시리즈는 절대 포함하지 마세요.
- 오직 러닝타임 1회로 완결되는 극장용 영화만 추천해야 합니다.
"""
    elif origin == "국내":
        origin_text = "국내 영화 (한국 영화)"
        origin_strict_rule = """
[🚨 절대 규칙 1: 100% 순수 대한민국(한국) 영화만 추천할 것]
- 추천하는 3편 모두 반드시 대한민국에서 제작된 '한국 영화'여야 합니다.
- 해외 영화(외화), 외국 영화, 외국 합작 작품은 단 1편도 포함하지 마세요.

[🚨 절대 규칙 2: 오직 '극장용 한국 영화'만 추천할 것 (드라마 배제)]
- TV 드라마, 웹드라마, OTT 오리지널 시리즈물은 절대 포함하지 마세요.
- 오직 1회로 완결되는 한국 장편 극장 영화만 추천해야 합니다.
"""
    else:
        origin_text = "전체 (국내 및 해외 영화 모두 포함)"
        origin_strict_rule = """
[🚨 절대 규칙 1: 제작 국가 무관 (국내 영화 및 해외 영화 모두 자유롭게 추천 가능)]
- 대한민국 영화와 해외 영화 구분 없이, 사용자가 원하는 스토리/분위기에 가장 잘 어울리는 최고의 명작 영화 3편을 추천하세요.
- 한국 영화와 해외 영화가 골고루 섞여도 좋습니다.

[🚨 절대 규칙 2: 오직 '단편/장편 영화(Feature Film)'만 추천할 것 (드라마 배제)]
- TV 시리즈, 드라마, OTT 오리지널 시리즈물은 절대 포함하지 마세요.
- 오직 러닝타임 1회로 완결되는 극장용 영화만 추천해야 합니다.
"""

    # 4. 캘린더 개봉 기간 엄격 필터링 룰 구성
    date_filter_rule = ""
    if start_date and end_date:
        date_filter_rule = f"""
[🚨 절대 규칙 3: 개봉 시기 / 출시 기간 엄격 제한]
- 반드시 {start_date} ~ {end_date} 사이에 극장 개봉(출시)된 영화만 3편 추천하세요.
- 이 개봉 기간을 벗어난 연도에 나온 영화는 단 1편도 추천해서는 안 됩니다.
"""
    elif start_date:
        date_filter_rule = f"""
[🚨 절대 규칙 3: 개봉 시기 / 출시 기간 엄격 제한]
- 반드시 {start_date} 이후에 개봉한 최신 영화만 3편 추천하세요.
"""
    elif end_date:
        date_filter_rule = f"""
[🚨 절대 규칙 3: 개봉 시기 / 출시 기간 엄격 제한]
- 반드시 {end_date} 이전에 개봉한 영화만 3편 추천하세요.
"""

    prompt = f"""
당신은 영화의 국적, 포맷, 개봉연도를 매우 정밀하게 검증하는 최고 수준의 전문 영화 큐레이터입니다.
사용자의 아래 요청 조건을 분석하여, 조건에 100% 부합하는 서로 다른 3편의 영화를 엄선해 주세요.

[사용자 요청 조건]
- 원하는 분위기 / 스토리: {keyword}
- 영화 장르: {genre if genre else '상관없음 (모든 장르 허용)'}
- 국가 구분: {origin_text}
- 선호하는 배우: {actor if actor else '상관없음'}
- 희망 상영시간: {runtime if runtime else '상관없음'}
- 희망 개봉기간: {f'{start_date} ~ {end_date}' if (start_date or end_date) else '제한없음'}

{origin_strict_rule}
{date_filter_rule}

반드시 아래와 같은 JSON 배열 형식으로만 응답해 주세요 (총 3개의 영화 객체):
[
  {{
    "title": "영화 공식 한국어 제목",
    "original_title": "영화 원제 (영문/원어)",
    "production_country": "제작 국가 (예: 미국, 영국, 일본, 한국 등)",
    "release_year": "개봉연도 (예: 2019)",
    "genre": "세부 장르",
    "director": "감독 이름",
    "cast": "주요 출연진 목록 (쉼표 구분)",
    "runtime": "상영시간 (예: 132분)",
    "plot": "흥미진진하고 몰입감 넘치는 3~4문장의 상세 줄거리 요약",
    "recommendation_reason": "이 영화를 특히 추천하는 이유 1~2문장"
  }}
]
"""

    try:
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

        clean_json_str = ai_result.strip()
        if clean_json_str.startswith("```"):
            clean_json_str = re.sub(r"^```(?:json)?\n", "", clean_json_str)
            clean_json_str = re.sub(r"\n```$", "", clean_json_str)

        movies_data = json.loads(clean_json_str)
        if isinstance(movies_data, dict):
            movies_data = [movies_data]

        enriched_movies = []
        for idx, movie_info in enumerate(movies_data[:3], start=1):
            movie_title = movie_info.get("title", "")
            release_year = movie_info.get("release_year", "")
            production_country = movie_info.get("production_country", "해외" if origin == "해외" else "대한민국")

            poster_url = search_poster_serper(movie_title, release_year)
            ott_info = search_ott_realtime(movie_title)

            enriched_movies.append({
                "rank": idx,
                "title": movie_title,
                "original_title": movie_info.get("original_title", ""),
                "production_country": production_country,
                "release_year": release_year,
                "genre": movie_info.get("genre", genre),
                "director": movie_info.get("director", "정보 없음"),
                "cast": movie_info.get("cast", "정보 없음"),
                "runtime": movie_info.get("runtime", "정보 없음"),
                "plot": movie_info.get("plot", "줄거리 정보가 제공되지 않았습니다."),
                "recommendation_reason": movie_info.get("recommendation_reason", "조건에 꼭 맞는 영화입니다."),
                "poster_url": poster_url,
                "ott_info": ott_info
            })

        return jsonify({"success": True, "movies": enriched_movies})

    except Exception as e:
        logger.error(f"추천 처리 중 오류 발생: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "error": f"영화 추천을 생성하는 중 문제가 발생했습니다: {str(e)}"
        }), 500


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
