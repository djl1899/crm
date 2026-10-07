import { HttpError } from '../http.js';
import { visibleGuides, CATEGORY_ORDER, GUIDE_DISCLAIMER } from '../guides/index.js';
import { GUIDE_PDFS } from '../guides/pdfs.js';

export default function register(route) {
  route('GET', '/guides', async ({ user }) => {
    const items = visibleGuides(user).map(({ body, ...meta }) => ({ ...meta, has_pdf: !!GUIDE_PDFS[meta.slug] }));
    return { items, categories: CATEGORY_ORDER.filter((c) => items.some((g) => g.category === c)) };
  });

  route('GET', '/guides/:slug', async ({ params, user }) => {
    const g = visibleGuides(user).find((x) => x.slug === params.slug);
    if (!g) throw new HttpError(404, 'Leitfaden nicht gefunden.');
    return { guide: { ...g, has_pdf: !!GUIDE_PDFS[g.slug] }, disclaimer: GUIDE_DISCLAIMER };
  });

  route('GET', '/guides/:slug/pdf', async ({ params, user }) => {
    const g = visibleGuides(user).find((x) => x.slug === params.slug);
    const b64 = g && GUIDE_PDFS[g.slug];
    if (!b64) throw new HttpError(404, 'PDF nicht gefunden.');
    return new Response(Buffer.from(b64, 'base64'), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Leitfaden-${g.slug}.pdf"`,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
}
