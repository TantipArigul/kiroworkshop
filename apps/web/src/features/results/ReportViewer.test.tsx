import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ReportViewer } from './ReportViewer';

describe('ReportViewer', () => {
  it('sandboxes the report frame with allow-scripts only', () => {
    const html = renderToStaticMarkup(
      <ReportViewer
        name="pipeline_info/execution_report_x.html"
        onClose={() => undefined}
        src="/api/v1/jobs/a/artifacts/b/view"
      />,
    );

    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain('allow-same-origin');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain('title="pipeline_info/execution_report_x.html"');
  });

  it('renders no frame without a view URL (mock mode)', () => {
    const html = renderToStaticMarkup(
      <ReportViewer name="report.html" onClose={() => undefined} src={null} />,
    );

    expect(html).not.toContain('<iframe');
    expect(html).toContain('Not available in mock mode');
  });
});
