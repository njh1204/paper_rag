# Paper Graph

비밀번호로 보호되는 읽기 전용 논문 라이브러리의 웹 애플리케이션 소스입니다.

## 공개 저장소 범위

이 저장소에는 애플리케이션 코드와 빈 로컬 설정 예시만 포함합니다. 다음
자료는 저장소와 Git 커밋 이력에 포함하지 않습니다.

- 논문 본문, 이미지, PDF 및 동기화 스냅샷
- 비밀번호, 세션, API 키 및 배포 자격 증명
- 개인 PC의 파일 경로와 로컬 실행 결과

실제 값은 호스팅 환경의 비공개 설정에서 관리합니다. `.dev.vars.example`의
값은 실행 가능한 자격 증명이 아닌 자리표시자입니다.

## 로컬 검증

```powershell
Copy-Item .dev.vars.example .dev.vars
npm.cmd ci
npm.cmd test
```

실제 값을 넣은 `.dev.vars`는 Git에서 제외됩니다.

## 보안

취약점을 발견했다면 공개 Issue에 세부 내용을 작성하지 말고 GitHub의
비공개 취약점 신고 기능을 이용해 주세요. 지원 범위와 대응 원칙은
[SECURITY.md](./SECURITY.md)에 있습니다.
