# Paper Graph

읽기 전용 계층형 논문 라이브러리입니다. 애플리케이션은 Cloudflare
Workers에서 실행되고, 메타데이터는 D1, Markdown과 이미지는 비공개 R2에
저장됩니다.

## 보안 경계

- 이 저장소에는 애플리케이션 소스와 빈 설정 예시만 보관합니다.
- 논문 Markdown, 이미지, PDF, 스냅샷과 로컬 절대 경로는 커밋하지 않습니다.
- 비밀번호, 동기화 키와 pepper는 Cloudflare secret으로만 설정합니다.
- R2 bucket은 공개하지 않으며 인증된 Worker API로만 읽습니다.
- 세션은 서버에 해시로 저장되고 발급 후 1시간에 절대 만료됩니다.
- 로컬 동기화는 timestamp, nonce, body SHA-256이 포함된 HMAC으로 인증합니다.

## 로컬 검증

```powershell
Copy-Item .dev.vars.example .dev.vars
npm ci
npm test
```

실제 값을 넣은 `.dev.vars`는 `.gitignore`에 의해 제외됩니다.

## Cloudflare 배포

Cloudflare 계정에서 `paper-rag` D1 database와 비공개
`paper-rag-vault` R2 bucket을 만든 뒤 `wrangler.jsonc`에 binding을
연결합니다. 다음 secret은 대시보드나 `wrangler secret put`으로만
설정합니다.

- `PASSWORD_PEPPER`
- `INITIAL_GUEST_PASSWORD`
- `SYNC_SECRET`

초기 비밀번호가 D1에 hash로 저장된 뒤에는
`INITIAL_GUEST_PASSWORD` secret을 삭제할 수 있습니다.
