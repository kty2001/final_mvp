// 시연용 가상 데이터: CVE ID, 점수, 날짜는 실제 정보와 무관함

const VULNS = [
  {
    id: 'CVE-2026-41001', product: 'Apache HTTP Server', title: '경로 조작을 통한 원격 코드 실행',
    affected: { from: '2.4.0', fixed: '2.4.66' }, cvss: 9.8, epss: 0.62, kev: true, kevDate: '2026-10-09',
    published: '2026-10-02', updatedAt: '2026-10-09',
    summary: '특정 모듈 설정에서 경로 정규화 오류로 인증 없이 원격 코드 실행 가능',
    mitigation: '취약 모듈 비활성화, 문서 루트 외 접근 차단',
    vendorUrl: 'https://httpd.apache.org/security/vulnerabilities_24.html',
    attack: { id: 'T1190', name: 'Exploit Public-Facing Application' },
    kisa: '보호나라 보안공지: Apache HTTP Server 보안 업데이트 권고',
  },
  {
    id: 'CVE-2026-41002', product: 'OpenSSH', title: '인증 전 경쟁 조건 원격 코드 실행',
    affected: { from: '8.5', fixed: '9.9' }, cvss: 8.1, epss: 0.12, kev: false,
    published: '2026-10-05', updatedAt: '2026-10-05',
    summary: '시그널 처리 경쟁 조건으로 인증 전 단계에서 원격 코드 실행 가능(공격 난이도 높음)',
    mitigation: 'LoginGraceTime 0 설정(서비스 거부 위험 존재), 접근 IP 제한',
    vendorUrl: 'https://www.openssh.com/security.html',
    attack: { id: 'T1021.004', name: 'Remote Services: SSH' },
  },
  {
    id: 'CVE-2026-41003', product: 'FortiOS', title: 'SSL-VPN 힙 오버플로',
    affected: { from: '7.0.0', fixed: '7.2.11' }, cvss: 9.6, epss: 0.45, kev: true, kevDate: '2026-10-12',
    published: '2026-10-08', updatedAt: '2026-10-12',
    summary: 'SSL-VPN 요청 처리 중 힙 오버플로로 인증 없이 원격 코드 실행 가능',
    mitigation: 'SSL-VPN 비활성화 또는 접근 IP 제한',
    vendorUrl: 'https://www.fortiguard.com/psirt',
    attack: { id: 'T1133', name: 'External Remote Services' },
    kisa: '보호나라 보안공지: Fortinet 제품 보안 업데이트 권고',
  },
  {
    id: 'CVE-2026-41004', product: 'nginx', title: 'HTTP/2 처리 서비스 거부',
    affected: { from: '1.20.0', fixed: '1.27.4' }, cvss: 7.5, epss: 0.08, kev: false,
    published: '2026-09-28', updatedAt: '2026-09-28',
    summary: 'HTTP/2 스트림 처리 과정의 자원 고갈로 서비스 거부 유발 가능',
    mitigation: 'HTTP/2 비활성화 또는 동시 스트림 수 제한',
    vendorUrl: 'https://nginx.org/en/security_advisories.html',
    attack: { id: 'T1499', name: 'Endpoint Denial of Service' },
  },
  {
    id: 'CVE-2026-41005', product: 'MySQL', title: '권한 상승 취약점',
    affected: { from: '8.0.0', fixed: '8.0.41' }, cvss: 6.5, epss: 0.03, kev: false,
    published: '2026-09-20', updatedAt: '2026-09-20',
    summary: '인증된 저권한 사용자가 특정 쿼리로 권한 상승 가능',
    mitigation: '불필요한 DB 계정 권한 회수',
    vendorUrl: 'https://www.oracle.com/security-alerts/',
    attack: { id: 'T1068', name: 'Exploitation for Privilege Escalation' },
  },
  {
    id: 'CVE-2026-41006', product: 'WordPress', title: '저장형 XSS',
    affected: { from: '6.0', fixed: '6.5.3' }, cvss: 5.4, epss: 0.02, kev: false,
    published: '2026-09-15', updatedAt: '2026-09-15',
    summary: '편집자 권한 사용자가 스크립트를 삽입해 방문자 브라우저에서 실행 가능',
    mitigation: '편집자 권한 최소화',
    vendorUrl: 'https://wordpress.org/news/category/security/',
    attack: { id: 'T1189', name: 'Drive-by Compromise' },
  },
  {
    id: 'CVE-2026-41007', product: 'Jenkins', title: '임의 파일 읽기를 통한 원격 코드 실행',
    affected: { from: '2.400', fixed: '2.471' }, cvss: 9.8, epss: 0.35, kev: false,
    published: '2026-10-10', updatedAt: '2026-10-10',
    summary: 'CLI 명령 파서 결함으로 임의 파일 읽기 후 원격 코드 실행으로 이어질 수 있음',
    mitigation: 'CLI 접근 비활성화',
    vendorUrl: 'https://www.jenkins.io/security/advisories/',
    attack: { id: 'T1190', name: 'Exploit Public-Facing Application' },
  },
  {
    id: 'CVE-2026-41008', product: 'Apache Tomcat', title: '부분 PUT 요청 원격 코드 실행',
    affected: { from: '9.0.0', fixed: '9.0.96' }, cvss: 7.3, epss: 0.05, kev: false,
    published: '2026-10-15', updatedAt: '2026-10-15',
    summary: '기본 서블릿 쓰기 허용 설정 시 부분 PUT 요청으로 원격 코드 실행 가능',
    mitigation: '기본 서블릿 readonly 설정 유지',
    vendorUrl: 'https://tomcat.apache.org/security-9.html',
    attack: { id: 'T1190', name: 'Exploit Public-Facing Application' },
  },
];

const SEED_ASSETS = [
  { id: 'A1', name: '고객 포털 웹서버', product: 'Apache HTTP Server', version: '2.4.58', type: '서버', criticality: '상', exposure: '예', purpose: '고객 대상 웹 서비스', patch: '미적용', owner: '인프라 담당' },
  { id: 'A2', name: '내부 테스트 웹서버', product: 'Apache HTTP Server', version: '2.4.58', type: '서버', criticality: '하', exposure: '아니오', purpose: '개발 테스트', patch: '미적용', owner: '개발팀' },
  { id: 'A3', name: '원격근무 VPN 게이트웨이', product: 'FortiOS', version: '7.2.8', type: '네트워크 장비', criticality: '상', exposure: '예', purpose: '임직원 원격 접속', patch: '미적용', owner: '인프라 담당' },
  { id: 'A4', name: '지사 방화벽', product: 'FortiOS', version: '', type: '네트워크 장비', criticality: '중', exposure: '예', purpose: '지사 인터넷 경계', patch: '확인 필요', owner: '인프라 담당' },
  { id: 'A5', name: '사내 CI 서버', product: 'Jenkins', version: '2.452', type: '서버', criticality: '중', exposure: '미확인', purpose: '빌드·배포 자동화', patch: '미적용', owner: '개발팀' },
  { id: 'A6', name: 'ERP DB 서버', product: 'MySQL', version: '8.0.36', type: 'DB', criticality: '상', exposure: '아니오', purpose: 'ERP 데이터 저장', patch: '미적용', owner: 'DB 담당' },
  { id: 'A7', name: '사내 위키', product: 'WordPress', version: '6.6.1', type: '웹 애플리케이션', criticality: '중', exposure: '예', purpose: '사내 문서 공유', patch: '미적용', owner: '경영지원팀' },
  { id: 'A8', name: '리버스 프록시', product: 'nginx', version: '1.26.2', type: '서버', criticality: '중', exposure: '예', purpose: '웹 트래픽 분산', patch: '적용 완료', owner: '인프라 담당' },
  { id: 'A9', name: '관리용 SSH 점프 서버', product: 'OpenSSH', version: '9.6', type: '서버', criticality: '중', exposure: '예', purpose: '서버 원격 관리', patch: '미적용', owner: '인프라 담당' },
];

const SEED_FEED = [
  { time: '2026-10-15 10:20', text: 'CVE-2026-41008 (Apache Tomcat) — NVD 신규 공개' },
  { time: '2026-10-12 09:05', text: 'CVE-2026-41003 (FortiOS) — CISA KEV 신규 등재' },
  { time: '2026-10-10 14:30', text: 'CVE-2026-41007 (Jenkins) — NVD 신규 공개, 공급업체 권고문 발행' },
  { time: '2026-10-09 08:40', text: 'CVE-2026-41001 (Apache HTTP Server) — CISA KEV 신규 등재' },
];

// 파트너(MSP)가 관리하는 샘플 고객사. trend: 이전 7주 [대응 필요 위협, 조치 완료 업무] 목업 값
const SEED_TENANTS = [
  {
    id: 'A', name: '샘플 A사', industry: 'IT 서비스', plan: '구독', assets: SEED_ASSETS,
    trend: [[5, 1], [6, 2], [6, 0], [7, 3], [6, 1], [7, 2], [7, 1]],
  },
  {
    id: 'B', name: '샘플 B사', industry: '제조 협력사', plan: '무료',
    assets: [
      { id: 'B1', name: 'MES 서버', product: 'Apache Tomcat', version: '9.0.80', type: '서버', criticality: '상', exposure: '아니오', purpose: '생산 관리 시스템', patch: '미적용', owner: '생산IT 담당' },
      { id: 'B2', name: '원격 접속 VPN', product: 'FortiOS', version: '7.0.12', type: '네트워크 장비', criticality: '상', exposure: '예', purpose: '협력사·재택 원격 접속', patch: '미적용', owner: '생산IT 담당' },
      { id: 'B3', name: '설계 파일 서버', product: 'OpenSSH', version: '9.3', type: '서버', criticality: '중', exposure: '미확인', purpose: '도면 파일 전송', patch: '미적용', owner: '생산IT 담당' },
      { id: 'B4', name: '그룹웨어', product: 'nginx', version: '1.24.0', type: '서버', criticality: '중', exposure: '예', purpose: '사내 메일·결재', patch: '미적용', owner: '총무팀' },
      { id: 'B5', name: '생산 DB', product: 'MySQL', version: '8.0.39', type: 'DB', criticality: '상', exposure: '아니오', purpose: '생산 실적 저장', patch: '미적용', owner: '생산IT 담당' },
    ],
    trend: [[3, 0], [3, 0], [4, 1], [4, 0], [5, 0], [5, 1], [5, 0]],
  },
  {
    id: 'C', name: '샘플 C사', industry: '물류', plan: '구독',
    assets: [
      { id: 'C1', name: '배송 조회 사이트', product: 'WordPress', version: '6.4.2', type: '웹 애플리케이션', criticality: '상', exposure: '예', purpose: '고객 배송 조회', patch: '미적용', owner: '웹 담당' },
      { id: 'C2', name: '고객 API 서버', product: 'Apache HTTP Server', version: '2.4.66', type: '서버', criticality: '상', exposure: '예', purpose: '화주사 연동 API', patch: '적용 완료', owner: '인프라 담당' },
      { id: 'C3', name: '빌드 서버', product: 'Jenkins', version: '2.480', type: '서버', criticality: '하', exposure: '아니오', purpose: '배포 자동화', patch: '적용 완료', owner: '개발팀' },
      { id: 'C4', name: '물류센터 VPN', product: 'FortiOS', version: '', type: '네트워크 장비', criticality: '상', exposure: '예', purpose: '센터 간 연결', patch: '확인 필요', owner: '인프라 담당' },
    ],
    trend: [[2, 1], [3, 1], [2, 2], [3, 0], [2, 1], [2, 1], [2, 0]],
  },
];

// 가격은 인터뷰 지불 의향 조사로 결정 예정 — 플랜 구조만 시연
const PLANS = [
  { id: '무료', target: '체험·소규모', price: '무료', assetLimit: 10, schedule: false, features: ['자산 10개', 'KEV 매칭 알림', '대화형 분석', '수동 리포트 생성'] },
  { id: '구독', target: '단일 기업', price: '가격 가설 검증 중', assetLimit: 100, schedule: true, features: ['자산 100개', '정기 리포트 예약·발송', '긴급 알림 리포트 자동 생성', '판단 수정 이력'] },
  { id: '파트너', target: 'MSP·IT 유지보수 업체', price: '가격 가설 검증 중', assetLimit: null, schedule: true, partnerOnly: true, features: ['고객사 다중 관리', '고객사별 위험 현황 비교', '고객사별 리포트', '자산 무제한'] },
];

const DEFAULT_SCHEDULES = {
  exec: { on: true, freq: '매주 월요일 09:00', to: 'ceo@example.com' },
  detail: { on: false, freq: '매주 월요일 09:00', to: 'it@example.com' },
  compliance: { on: true, freq: '매월 1일 09:00', to: 'audit@example.com' },
};

// "위협 정보 갱신 시뮬레이션" 버튼 클릭 시 순서대로 적용
const SIM_UPDATES = [
  { cveId: 'CVE-2026-41007', changes: { kev: true, kevDate: '2026-10-17', epss: 0.81 }, text: 'CISA KEV 신규 등재, EPSS 0.35 → 0.81' },
  { cveId: 'CVE-2026-41005', changes: { cvss: 8.8, epss: 0.22 }, text: 'NVD CVSS 재평가 6.5 → 8.8, EPSS 0.03 → 0.22' },
];
