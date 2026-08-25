# 꿍푸씨의 캘린더

꿍과 푸가 함께 쓰는 모바일 공유 캘린더입니다.

## 특징

- 처음 접속할 때 비밀번호 없음
- 꿍 / 푸 / 둘 일정 구분
- 월간 달력, 선택한 날 일정, 다가오는 일정
- 빠른 일정 추가/수정/삭제
- 공유 메모
- Supabase Realtime 동기화
- Cloudflare Pages 정적 배포 가능

## Supabase 설정

Supabase SQL Editor에서 `supabase-calendar-schema.sql` 전체를 실행합니다.

성공하면 아래 결과가 나옵니다.

```text
calendar ready
```

## Cloudflare Pages 설정

GitHub 저장소에 이 폴더 안 파일을 올리고 Pages에서 연결합니다.

```text
Framework preset: None
Build command: 비워두기
Build output directory: /
Root directory: 비워두기
```

배포 후 주소 뒤에 `?v=1`을 붙여 접속하면 최신 캐시로 열립니다.
