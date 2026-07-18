import 'react';

// The @cynco packages ship JSX typings for their custom elements behind a
// triple-slash reference that tsdown does not propagate into the dist entry
// declarations, so the augmentation is restated here for the hook-based
// usages that render the container element directly.
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'accounts-container': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
      'journals-container': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}
