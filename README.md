# Travely — 둘이 같이 쓰는 여행 플래너 (PWA)

일정·지도·예약함·가계부·준비물을 두 계정이 **같은 데이터로 실시간** 함께 고치는 휴대폰용 웹앱.
**추가 요금 0원** 구성: GitHub Pages(앱) + Firebase Spark 무료(로그인·DB) + Cloudflare Workers 무료(경로 조회 중계) + OpenStreetMap(지도).
카드 등록이 필요한 서비스(Firebase Blaze, Cloud Storage, Cloud Functions, Google Maps)는 쓰지 않는다.

React 19 · TypeScript · Vite 8 · Firebase 13(Auth + Firestore) · Leaflet + OpenStreetMap · pdf.js · dnd-kit · vite-plugin-pwa

---

## 1. 기능

| 탭 | 내용 |
|---|---|
| 홈 | 다가오는 여행 / 지난 여행 탭, D-day, 국가·도시·통화·일러스트 선택, 샘플 여행(사진 속 칭다오·옌타이 일정) |
| 일정 | DAY별 타임라인 · 번호는 날짜마다 1부터, 장소만 번호 · 시간 미정 허용 · **길게 눌러 드래그**로 순서 변경 + 위/아래 버튼 · 다른 날짜로 이동 · **후보 장소**(날짜 없음) → 일정에 넣기 · 일정마다 메모 + 체크 항목(바우처 종이 지참·표 받는 곳 등 자주 쓰는 문구) · 장소 사이 **이동 정보**(수단·시간·거리·요금·메모) · 날씨(Open-Meteo, 16일 이내) |
| 지도 | OpenStreetMap 실제 지도 · 일정과 같은 번호 핀 · **점선 화살표 = 방문 순서**, **실선 = 경로 조회한 실제 길** · 같은 장소 재방문은 한 핀에 `1·4` · 위치 미지정 장소는 목록으로 안내 · 핀 누르면 카드(다음 장소·이동 정보) · 지도 서버가 6초 안에 안 열리면 간이 순서도로 자동 전환 |
| 예약함 | 항공·숙소·교통·입장권·기타 · 예약번호 복사 · 사진/PDF 첨부(최대 10MB, 썸네일, 원본 보기, 확대) · 일정과 연결 · **항공 예약은 타임라인에 항공편 카드로 자동 표시** · 편명 자동 조회(선택) |
| 가계부 | 결제 통화 + 저장 당시 환율(무료 일일 환율) + 카드 명세서 실제 원화(선택) · 결제수단(현금/신용/체크/알리페이/위챗/기타) · 카드 이름 · 플랫폼 · **누가 결제(여러 명 가능)** · **분담: 반반 / 나만 / 상대만 / 금액 지정 / 비율** · 최종 정산 “누가 → 누구에게 얼마” (원화 정수, 1원 오차 없음) · 분류·결제수단별 합계 · 환율 계산기 |
| 준비물 | 담당(나/상대/공동) · 체크 진행률 · 필터 · 완료 숨기기 · 순서 드래그 · 지난 여행에서 복사 |
| 공유·설정 | 초대 링크(기본 **같이 편집**, 보기 전용 선택, 1/7/30일 만료, 폐기) · 권한 변경 · 내보내기/복구 · 여행 정보 수정(기간을 줄이면 사라지는 날짜의 일정은 **후보 장소로 이동**) · 여행 삭제 |

공통: 저장 상태(저장 중/완료/실패/충돌/오프라인) 표시 · 같은 항목을 둘이 동시에 고치면 **나중 저장이 조용히 덮어쓰지 않고 충돌 안내** · 오프라인에서 열어 본 여행·첨부 파일 열람.

### 데이터 구조 (Firestore)
```
trips/{tripId}                 name, countryCode, cities[], startDate, endDate, timezone, baseCurrency, illustration, ownerUid
  members/{uid}                role(owner|editor|viewer), status(active|removed), displayName, inviteToken
  invites/{token}              role, expiresAt, revoked, tripName, inviterName      ← 토큰 = 43자 난수
  days/{YYYY-MM-DD}            index, city
  items/{id}                   dayId(null=후보), order, kind(place|memo|flight), category, tag, time, memo, place{}, bookingIds[], checklist[], version
  legs/{출발ID__도착ID}         mode, durationMin, distanceM, fareAmount, fareCurrency, memo, source(route|manual), geometry(polyline), routedFrom/To, version
  bookings/{id}                type, title, start/end date·time, reservationNo, memo, flight{}, fileIds[], version
  files/{id}                   name, mime, size, pages, thumb, chunkCount, complete
    chunks/{0000..}            data(bytes ≤ 700KB)            ← Cloud Storage 대신 Firestore 에 조각 저장
  expenses/{id}                title, date, amount, currency, krwRate, krwActual, method, cardName, platform, payers{uid:금액}, split{mode, shares}, version
  packing/{id}                 text, owner(uid|shared), done, order, version
```
권한은 `firestore.rules` 가 **서버에서** 다시 검사한다: 멤버만 읽기, 보기 권한은 쓰기 거부, 수정은 `version` 이 정확히 +1 일 때만, 초대는 유효한 토큰의 권한 그대로만 참여, 내보낸 계정은 같은 링크로 재참여 불가.

---

## 2. 처음 설정 (한 번만, 30분 정도)

준비물: GitHub 계정, Google 계정(Firebase), Cloudflare 계정(무료, 카드 불필요), OpenRouteService 계정(무료), PC 1대(Node 22).

### ① Firebase (무료 Spark — 결제 수단 등록하지 말 것)
1. https://console.firebase.google.com → **프로젝트 추가** (Google 애널리틱스 꺼도 됨). 요금제가 **Spark** 인지 확인.
2. **빌드 > Authentication > 시작하기 > 이메일/비밀번호** 사용 설정.
3. **Authentication > 설정 > 승인된 도메인**에 `<깃허브아이디>.github.io` 추가.
4. **빌드 > Firestore Database > 데이터베이스 만들기** → 위치 `asia-northeast3 (서울)` → **프로덕션 모드**.
5. **프로젝트 설정 > 내 앱 > 웹 앱(</>) 추가** → 나오는 `apiKey / authDomain / projectId / appId` 메모 (공개돼도 되는 식별자. 서비스 계정 키는 받지도 넣지도 말 것).
6. 보안 규칙·색인: 콘솔 **Firestore > 규칙** 에 `firestore.rules` 붙여넣고 게시 + **색인 > 단일 필드 > 예외 추가** (members / uid / 컬렉션 그룹 오름차순).
   또는 PC에서 명령으로:
   ```bash
   npm install
   npx firebase login
   npm run deploy:rules
   ```

### ② 경로 조회 중계 서버 (Cloudflare Workers 무료)
1. https://openrouteservice.org/dev/#/signup → 가입 → **API Key** 발급 (무료: 하루 2,000회).
2. `worker/wrangler.toml` 에서 `FIREBASE_PROJECT_ID` 와 `ALLOWED_ORIGINS`(`https://<깃허브아이디>.github.io`) 수정.
3. 배포:
   ```bash
   cd worker && npm install
   npx wrangler login
   npx wrangler secret put ORS_API_KEY        # 붙여넣기 (저장소에는 절대 안 들어감)
   npx wrangler deploy                        # → https://travely-api.<계정>.workers.dev 주소 메모
   ```
4. (선택) 편명으로 시각 불러오기: RapidAPI 에서 AeroDataBox 무료 플랜 구독 → `npx wrangler secret put RAPIDAPI_KEY` → 아래 ③에서 변수 `VITE_FLIGHT_LOOKUP=true`.
   안 하면 항공편은 직접 입력(진에어 LJ841 07:20→08:15 같은 값).

### ③ GitHub Pages
1. GitHub 에 **공개(Public)** 저장소 생성 → 이 폴더 내용을 올림.
2. 저장소 **Settings > Pages > Source = GitHub Actions**.
3. Firebase 웹 설정·중계 서버 주소는 `.env.production` 에 적는다 (공개돼도 되는 식별자. 실제 접근 통제는 `firestore.rules`).
   비밀키(ORS·RapidAPI)는 여기 말고 Cloudflare 에만 등록.
4. `main` 에 push → Actions 가 단위 테스트 후 빌드·배포 → `https://<깃허브아이디>.github.io/<저장소>/`
   앱은 다음에 완전히 껐다 켤 때 새 버전으로 자동 교체(데이터는 그대로).

### ④ 휴대폰에 설치 · 여자친구 초대
1. 아이폰 Safari / 안드로이드 Chrome 으로 주소 열기 → **공유 > 홈 화면에 추가**.
2. 가입 → 새 여행 만들기 → 오른쪽 위 사람 아이콘 → **초대 링크 만들기**(기본 같이 편집) → 카톡으로 전송.
3. 상대가 링크 열고 가입 → **여행에 참여하기**. 이후 둘이 고치는 내용이 바로 반영됨.

---

## 3. 무료 한도 (둘이 쓰면 넉넉함)

| 서비스 | 무료 한도 | 메모 |
|---|---|---|
| Firestore | 저장 1GiB, 읽기 5만/일, 쓰기 2만/일 | 한도를 넘으면 **요금이 나가는 게 아니라 그날 멈춤**(Spark 는 결제 수단이 없음) |
| 첨부 파일 | 1개 최대 10MB (사진은 자동 압축) | Firestore 저장 1GiB 안에서 사용 |
| OpenRouteService | 경로 조회 2,000회/일 | 버튼 누를 때만 조회 + 결과는 일정에 저장, 중계 서버 7일 캐시 |
| Cloudflare Workers | 요청 10만/일 | |
| OpenStreetMap 타일·Nominatim 검색 | 공정 사용 정책 | 검색은 1초 1회로 제한해 둠 |
| Open-Meteo 날씨 / 환율 API | 비상업 무료, 키 없음 | |

---

## 4. 개발 · 테스트

```bash
npm run dev:demo     # 서버 없이 메모리 데이터로 실행 (샘플 여행 포함) → http://127.0.0.1:5173
npm run dev          # .env.local 의 실제 Firebase 로 실행
npm run test:unit    # 정산·순서·지도 모델·파일 조각·기간 변경·중계 서버 (41개)
npm run test:ui      # 모든 탭 화면 동작 (메모리 모드, Playwright 9개)
npm run emulators    # (다른 창) Firebase 에뮬레이터
npm run test:rules   # 보안 규칙 (에뮬레이터 필요)
npm run test:e2e     # 두 계정 실시간 공유 (에뮬레이터 필요)
```

---

## 5. 검증 상태 — 꼭 읽기

**확인 완료** (이 개발 환경에서 실행): 단위 테스트 41개 통과, 화면 테스트 9개 통과(일정 추가·체크·이동 정보·터치 드래그·후보 장소, 지도 대체 화면, 예약 사진/PDF 업로드·원본 보기·항공편 자동 카드, 가계부 정산 계산, 준비물, 공유·기간 축소, 320/390px 폭 넘침 없음), 타입 검사·빌드 통과.

**미검증** (개발 환경이 외부 인터넷 차단이라 실행 못 함 — 설정 후 직접 확인 필요):
- Firebase 실서버 연결, **보안 규칙 테스트(`test:rules`)·두 계정 실시간 공유 테스트(`test:e2e`)** — 코드는 들어 있으나 에뮬레이터 다운로드가 막혀 실행 못 함. ①-6 이후 `npm run emulators` + `npm run test:rules` 로 먼저 돌려 볼 것
- OpenStreetMap 실제 지도 타일, Nominatim 장소 검색
- OpenRouteService 경로 조회(중계 서버), AeroDataBox 편명 조회
- Open-Meteo 날씨, 환율 API(Frankfurter / ExchangeRate-API open)
- 실제 아이폰·안드로이드 기기(홈 화면 설치, 길게 눌러 드래그, 파일 선택)
- **중국 현지 접속**: Firebase(Google)·OSM 은 중국 현지 와이파이/유심에서 막히거나 느릴 수 있음. 한국 유심 로밍·eSIM(로밍형)은 보통 접속됨. 출국 전에 여행과 첨부 파일을 한 번씩 열어 두면 오프라인으로도 볼 수 있음(편집은 연결될 때만)
