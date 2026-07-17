import 'react';
import type { ACCOUNTS_TAG_NAME } from '../constants';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      [ACCOUNTS_TAG_NAME]: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}
