import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { HEALTH_QUESTIONS_NOTE, ResultReferences } from './ResultReferences';

// References and limits (design C8, D3-8).

function render(references: { label: string; href: string }[]) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <ResultReferences references={references} />
    </MemoryRouter>,
  );
}

describe('ResultReferences', () => {
  it('routes in-app links and opens external links without opener or referrer', () => {
    const html = render([
      { href: '/help#results', label: 'Guide: reading a result' },
      { href: 'https://www.nextflow.io/docs/latest/', label: 'Nextflow documentation' },
    ]);
    expect(html).toContain('<a href="/help#results"');
    expect(html).not.toMatch(/href="\/help#results"[^>]*target=/);
    expect(html).toContain(
      'href="https://www.nextflow.io/docs/latest/" rel="noopener noreferrer" target="_blank"',
    );
    expect(html).toContain('(opens in a new tab)');
  });

  it('always shows the training disclaimer and the health-questions note', () => {
    for (const html of [render([]), render([{ href: '/help', label: 'Guide' }])]) {
      expect(html).toContain('Training output only. Not a medical diagnosis or treatment advice.');
      expect(html).toContain(HEALTH_QUESTIONS_NOTE);
    }
    expect(HEALTH_QUESTIONS_NOTE).toBe('For health questions, consult a qualified professional.');
    expect(render([])).toContain('No references are listed for this result.');
  });
});
