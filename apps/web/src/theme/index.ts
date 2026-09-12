import { extendTheme, type ThemeConfig } from '@chakra-ui/react';

/**
 * ForgeRoutine design language (§36).
 *
 * Dark-first developer tool, not a consumer app. The brand accent `#ED7F11` comes
 * from the anvil-and-flame mark and is used **sparingly** — for the current action,
 * focus rings, and the one number that matters on a screen. An accent that is
 * everywhere signals nothing.
 *
 * Deliberately absent: rounded oversized cards, gradients, celebratory animation.
 * Childish reward loops train the wrong behaviour.
 */

const config: ThemeConfig = {
  initialColorMode: 'dark',
  useSystemColorMode: false,
};

const colors = {
  forge: {
    50: '#FFF4E6',
    100: '#FFE3BF',
    200: '#FFCE94',
    300: '#FAB565',
    400: '#F49A3B',
    500: '#ED7F11', // brand accent
    600: '#C9670A',
    700: '#9E5006',
    800: '#733A04',
    900: '#4A2402',
  },
  /** Near-black surfaces with a slight warm cast, so the accent sits naturally. */
  surface: {
    0: '#0B0C0E',
    50: '#111317',
    100: '#161920',
    200: '#1D2129',
    300: '#252A34',
    400: '#2F3540',
    500: '#3C434F',
  },
  ink: {
    100: '#F2F4F7',
    200: '#D5DAE2',
    300: '#A8B0BD',
    400: '#7B8494',
    500: '#5A6371',
  },
  /** Semantic states. Green is reserved for passing tests, never for decoration. */
  pass: '#3FB950',
  fail: '#F85149',
  warn: '#D29922',
  info: '#58A6FF',
};

const fonts = {
  heading:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  body: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  mono: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, Consolas, monospace",
};

export const theme = extendTheme({
  config,
  colors,
  fonts,
  fontSizes: {
    xs: '0.6875rem',
    sm: '0.8125rem',
    md: '0.875rem',
    lg: '1rem',
    xl: '1.125rem',
    '2xl': '1.375rem',
    '3xl': '1.75rem',
  },
  radii: {
    // Small radii throughout: this should read as a tool, not a toy.
    sm: '3px',
    md: '4px',
    lg: '6px',
    xl: '8px',
  },
  styles: {
    global: {
      'html, body, #root': {
        height: '100%',
        bg: 'surface.0',
        color: 'ink.100',
      },
      body: {
        fontSize: 'md',
        lineHeight: 1.55,
        fontFeatureSettings: "'cv02', 'cv03', 'cv04', 'tnum'",
      },
      '*::selection': {
        bg: 'forge.500',
        color: 'surface.0',
      },
      // A visible, consistent focus ring. Keyboard use is a first-class path here.
      '*:focus-visible': {
        outline: '2px solid',
        outlineColor: 'forge.500',
        outlineOffset: '2px',
      },
      '::-webkit-scrollbar': { width: '10px', height: '10px' },
      '::-webkit-scrollbar-track': { bg: 'surface.50' },
      '::-webkit-scrollbar-thumb': {
        bg: 'surface.400',
        borderRadius: '5px',
        border: '2px solid',
        borderColor: 'surface.50',
      },
    },
  },
  components: {
    Button: {
      baseStyle: {
        fontWeight: 600,
        borderRadius: 'md',
        letterSpacing: '0.01em',
      },
      defaultProps: { size: 'sm' },
      variants: {
        solid: {
          bg: 'forge.500',
          color: 'surface.0',
          _hover: { bg: 'forge.400', _disabled: { bg: 'forge.500' } },
          _active: { bg: 'forge.600' },
        },
        outline: {
          borderColor: 'surface.400',
          color: 'ink.200',
          _hover: { bg: 'surface.200', borderColor: 'surface.500' },
        },
        ghost: {
          color: 'ink.300',
          _hover: { bg: 'surface.200', color: 'ink.100' },
        },
      },
    },
    Card: {
      baseStyle: {
        container: {
          bg: 'surface.100',
          borderWidth: '1px',
          borderColor: 'surface.300',
          borderRadius: 'lg',
        },
      },
    },
    Input: {
      defaultProps: { size: 'sm', variant: 'filled' },
      variants: {
        filled: {
          field: {
            bg: 'surface.200',
            borderWidth: '1px',
            borderColor: 'surface.300',
            borderRadius: 'md',
            _hover: { bg: 'surface.200', borderColor: 'surface.400' },
            _focusVisible: { bg: 'surface.200', borderColor: 'forge.500' },
          },
        },
      },
    },
    Heading: {
      baseStyle: { fontWeight: 650, letterSpacing: '-0.015em' },
    },
    Progress: {
      baseStyle: {
        track: { bg: 'surface.300', borderRadius: 'sm' },
      },
    },
  },
});
