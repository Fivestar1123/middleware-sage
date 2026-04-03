export interface LogEntry {
  lineNumber: number;
  timestamp: string;
  level: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
  source: string;
  message: string;
}

export const mockLogText = `[2024-03-15 09:12:01.234] [INFO] [JEUS-WAS-01] Server startup completed in 12345ms
[2024-03-15 09:15:23.456] [INFO] [WebtoB-01] HTTP listener started on port 8080
[2024-03-15 09:30:45.001] [WARN] [JEUS-WAS-01] Thread pool usage exceeded 80% (162/200)
[2024-03-15 09:31:02.112] [WARN] [JEUS-WAS-01] DB Connection pool nearing limit: 45/50 active connections
[2024-03-15 09:45:12.789] [ERROR] [JEUS-WAS-01] java.lang.OutOfMemoryError: Java heap space
	at java.util.Arrays.copyOf(Arrays.java:3210)
	at java.util.ArrayList.grow(ArrayList.java:265)
	at com.example.service.DataProcessor.processLargeDataSet(DataProcessor.java:142)
	at com.example.controller.ReportController.generateReport(ReportController.java:89)
[2024-03-15 09:45:13.001] [ERROR] [JEUS-WAS-01] Session abnormal closed: connection reset by peer
	at jeus.servlet.engine.SessionManager.invalidateSession(SessionManager.java:234)
	at jeus.servlet.engine.HttpSession.expire(HttpSession.java:178)
[2024-03-15 09:45:14.555] [ERROR] [WebtoB-01] Backend server connection not closed properly
	at webtob.connector.BackendConnector.releaseConnection(BackendConnector.java:312)
	at webtob.connector.PoolManager.returnConnection(PoolManager.java:156)
[2024-03-15 09:46:00.000] [WARN] [Apache-01] mod_jk: worker ajp13 connection timeout after 30000ms
[2024-03-15 09:46:01.234] [ERROR] [Tomcat-01] org.apache.catalina.connector.ClientAbortException: java.io.IOException: Connection reset by peer
	at org.apache.catalina.connector.OutputBuffer.realWriteBytes(OutputBuffer.java:393)
	at org.apache.tomcat.util.net.NioEndpoint$SocketProcessor.doRun(NioEndpoint.java:1784)
[2024-03-15 09:50:00.111] [INFO] [JEUS-WAS-01] GC triggered: Full GC - Old Gen usage 95%
[2024-03-15 09:50:05.222] [WARN] [JEUS-WAS-01] GC pause time exceeded threshold: 8234ms > 5000ms
[2024-03-15 09:55:30.333] [ERROR] [JEUS-WAS-01] java.lang.OutOfMemoryError: GC overhead limit exceeded
	at java.lang.String.substring(String.java:1969)
	at com.example.cache.CacheManager.evict(CacheManager.java:78)
[2024-03-15 10:00:00.444] [INFO] [WebtoB-01] Health check passed for all backend servers
[2024-03-15 10:05:12.555] [WARN] [Apache-01] Request processing time exceeded 10s for /api/reports/generate`;

export function parseLogEntries(logText: string): LogEntry[] {
  return logText.split('\n').filter(line => line.trim()).map((line, idx) => {
    const tsMatch = line.match(/\[([\d\-: .]+)\]/);
    const levelMatch = line.match(/\[(ERROR|WARN|INFO|DEBUG)\]/);
    const sourceMatch = line.match(/\[([A-Za-z][\w-]+)\]/g);
    const isStackTrace = line.startsWith('\tat ');

    if (isStackTrace) {
      return {
        lineNumber: idx + 1,
        timestamp: '',
        level: 'ERROR' as const,
        source: '',
        message: line,
      };
    }

    return {
      lineNumber: idx + 1,
      timestamp: tsMatch?.[1] || '',
      level: (levelMatch?.[1] as LogEntry['level']) || 'INFO',
      source: sourceMatch?.[2]?.replace(/[[\]]/g, '') || '',
      message: line,
    };
  });
}

export interface AnalysisResult {
  severity: 'critical' | 'warning' | 'info';
  title: string;
  cause: string;
  recommendation: string;
  impact: string;
  relatedLines: number[];
}

export const mockAnalysisResults: AnalysisResult[] = [
  {
    severity: 'critical',
    title: 'OutOfMemoryError - Java Heap Space 부족',
    cause: 'DataProcessor.processLargeDataSet()에서 대용량 데이터 처리 시 ArrayList가 무한히 증가하여 Heap 메모리가 고갈됨. GC overhead limit도 초과하여 시스템이 사실상 응답 불가 상태.',
    recommendation: '1. JVM Heap 크기 증가 (-Xmx 조정)\n2. DataProcessor의 배치 처리 로직 도입\n3. CacheManager의 eviction 정책 점검\n4. 메모리 프로파일링 수행 (MAT 활용)',
    impact: '전체 WAS 인스턴스 응답 불가. 연결된 WebtoB/Apache를 통한 모든 사용자 요청 실패 가능.',
    relatedLines: [5, 6, 7, 8, 11, 12, 13],
  },
  {
    severity: 'critical',
    title: '세션 비정상 종료 (Abnormal Closed)',
    cause: 'OOM 발생 이후 세션 매니저가 정상 동작하지 못해 사용자 세션이 강제 종료됨. Connection reset by peer는 클라이언트 측 연결이 서버 장애로 인해 끊어진 것을 의미.',
    recommendation: '1. OOM 문제 해결 후 세션 안정성 자동 복구 확인\n2. 세션 클러스터링 설정 점검\n3. 세션 타임아웃 값 적정성 검토',
    impact: '로그인 사용자 세션 유실. 작업 중 데이터 손실 가능.',
    relatedLines: [9, 10],
  },
  {
    severity: 'warning',
    title: 'DB 커넥션 풀 포화 임박',
    cause: '50개 커넥션 풀 중 45개가 사용 중. 트래픽 증가 시 커넥션 부족으로 서비스 장애 발생 가능.',
    recommendation: '1. 커넥션 풀 최대값 증가 검토\n2. 슬로우 쿼리 분석 및 최적화\n3. 커넥션 반환 로직 점검 (not closed 이슈 연관 가능)',
    impact: '신규 DB 요청 대기 또는 실패. 전체 서비스 응답 지연.',
    relatedLines: [4],
  },
  {
    severity: 'warning',
    title: 'GC Pause Time 초과',
    cause: 'Full GC 수행 시 8.2초 동안 STW(Stop-The-World) 발생. Old Gen 사용률 95%로 메모리 압박 상태.',
    recommendation: '1. GC 알고리즘 변경 검토 (G1GC → ZGC)\n2. Heap 덤프 분석으로 메모리 누수 지점 확인\n3. Young/Old Gen 비율 조정',
    impact: '8초간 모든 요청 응답 중단. 사용자 체감 장애 발생.',
    relatedLines: [11, 12],
  },
];

export const dashboardStats = {
  critical: 4,
  warning: 4,
  info: 3,
  totalLines: 15,
  timeRange: '09:12 ~ 10:05',
  sources: ['JEUS-WAS-01', 'WebtoB-01', 'Apache-01', 'Tomcat-01'],
};
