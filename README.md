# Paper Graph

비밀번호로 보호되는 읽기 전용 계층형 논문 라이브러리입니다. UI와 API는
Cloudflare Workers에서 실행하고, generation/manifest/session은 D1,
Markdown과 이미지는 비공개 R2에 저장합니다.

## 보안 경계

- 공개 Git에는 애플리케이션 코드, migration, 빈 설정 예시만 포함합니다.
- 논문 Markdown·이미지·PDF·스냅샷·로컬 경로는 커밋하지 않습니다.
- 비밀번호, password pepper, 동기화 키는 Cloudflare secret으로만 설정합니다.
- R2에는 공개 URL이 없으며 인증된 Worker API만 접근할 수 있습니다.
- 세션은 서버에 해시로 저장하고 발급 후 정확히 1시간에 만료합니다.
- 동기화는 timestamp, nonce, body SHA-256을 포함한 HMAC으로 인증합니다.
- 로그인·읽기·동기화 API는 별도의 Cloudflare edge rate limit을 사용합니다.
- 요청 본문, 개별 blob, manifest 파일 수, 총 스냅샷 크기, MIME, logical
  path를 쓰기 전에 제한합니다.
- Workers Free 플랜의 요청당 10ms·하루 100,000건 강제 한도를 유지하고
  로그 샘플링은 1%입니다.

세부 대응 절차는 [SECURITY.md](./SECURITY.md)를 참고하세요.

## 로컬 검증

```powershell
Copy-Item .dev.vars.example .dev.vars
npm.cmd ci
npm.cmd test
```

실제 값을 넣은 `.dev.vars`는 `.gitignore`에 의해 제외되며 공개 저장소에
존재해서는 안 됩니다.

## Cloudflare 배포

`paper-rag` D1과 비공개 `paper-rag-vault` R2를 생성하고
`wrangler.jsonc`의 binding을 연결합니다. migration을 적용한 다음 다음
secret을 `wrangler secret put`으로 입력합니다.

- `PASSWORD_PEPPER`
- `INITIAL_GUEST_PASSWORD`
- `SYNC_SECRET`

```powershell
npx.cmd wrangler d1 migrations apply paper-rag --remote
npm.cmd run build
npx.cmd wrangler deploy --config dist/server/wrangler.json
```

초기 로그인에서 비밀번호 해시가 D1에 생성된 후에는
`INITIAL_GUEST_PASSWORD` secret을 삭제할 수 있습니다.

Cloudflare Billing의 **Billable Usage**에서 낮은 budget alert를 설정하고,
명시적으로 승인하기 전에는 Workers Free plan과 R2 Standard storage를
유지하세요.
