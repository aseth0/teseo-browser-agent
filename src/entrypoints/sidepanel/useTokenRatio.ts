// How far the estimates are from what this model's server reports (context/token-ratio), kept up to date.
import { useEffect, useState } from 'react';
import { onTokenRatios, tokenRatios } from '../../context/token-ratio';
import { modelKey } from '../../core/util';

export function useTokenRatio(providerId: string | undefined, model: string): number | undefined {
  const [ratios, setRatios] = useState<Record<string, number>>({});
  useEffect(() => {
    void tokenRatios().then(setRatios);
    return onTokenRatios(setRatios);
  }, []);
  return providerId ? ratios[modelKey(providerId, model)] : undefined;
}
