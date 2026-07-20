import type { Metadata } from 'next';

import { PlaygroundClient } from './PlaygroundClient';
import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';

export const metadata: Metadata = {
  title: 'Playground',
  description:
    'Paste or drop a transactions CSV and browse it as a live chart of ' +
    'accounts and register, rendered by @cynco/accounts and @cynco/journals.',
};

// font-mono on the wrapper puts the whole tool page in the brand mono —
// same width and type treatment as the perf lab, its sibling tool page.
export default function PlaygroundPage() {
  return (
    <div className="mx-auto min-h-screen max-w-6xl px-5 font-mono">
      <Header />
      <main id="main" className="py-8">
        <PlaygroundClient />
      </main>
      <Footer />
    </div>
  );
}
