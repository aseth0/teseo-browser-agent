import { useMediaQuery } from '../appearance';

export const useReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');
