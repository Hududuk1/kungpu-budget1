# Cloudflare D1 설정

이 앱은 Cloudflare Pages Functions와 D1을 사용합니다. Supabase 설정은 필요하지 않습니다.

## 최초 한 번만 할 일

1. Cloudflare 대시보드에서 **Storage & Databases > D1 SQL database**로 이동합니다.
2. `kungpu-budget`이라는 데이터베이스를 만듭니다.
3. 표시된 Database ID를 `wrangler.jsonc`의 `REPLACE_WITH_D1_DATABASE_ID`와 교체합니다.
4. Cloudflare에서 API Token을 만듭니다. 최소 권한은 다음과 같습니다.
   - Account > Cloudflare Pages > Edit
   - Account > D1 > Edit
5. GitHub 저장소의 **Settings > Secrets and variables > Actions**에 다음 값을 등록합니다.
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_API_TOKEN`
6. 변경 사항을 `main` 브랜치에 푸시합니다.

GitHub Actions가 `migrations/0001_init.sql`을 D1에 적용한 다음 Cloudflare Pages에 앱을 배포합니다.

## 로컬 실행

```sh
pnpm install
pnpm run db:migrate:local
pnpm run dev
```

로컬 D1 데이터는 `.wrangler/` 아래에 만들어지며 Git에 포함되지 않습니다.

## 데이터 관련 주의사항

- 처음 접속하면 꿍과 푸의 개인 비밀번호를 각각 설정합니다. 공동 비밀번호 단계는 없습니다.
- 기존 Supabase 데이터는 자동으로 옮겨지지 않습니다.
- 영수증 이미지는 D1에 최대 1.5MB까지 저장됩니다.
- 개인 비밀번호는 원문이 아니라 PBKDF2 해시로 저장됩니다.
