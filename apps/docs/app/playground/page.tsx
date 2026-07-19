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

export default function PlaygroundPage() {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5">
      <Header />
      <main id="main" className="py-8">
        <PlaygroundClient />
      </main>
      <Footer />
    </div>
  );
}
