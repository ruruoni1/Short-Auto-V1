import type { CSSProperties, ReactNode } from 'react';
import { samplePlannedSceneMotion, selectThemeColor, selectThemeFont } from '../../index.js';
import type { PlannedScene, ThemeSelection } from '../../index.js';
export interface SceneBodyProps { plan: PlannedScene; sourceTimeMs: number; theme: ThemeSelection; portrait: boolean; outputScale?: number }
export function editorStyle(value: PlannedScene['mainText'], outputScale = 1): CSSProperties {
  return { translate: `${(value.offsetX ?? 0)/outputScale}px ${(value.offsetY ?? 0)/outputScale}px`, scale: value.scale ?? 1,
    ...(value.fontSize !== undefined ? { fontSize: value.fontSize/outputScale } : {}), ...(value.width !== undefined ? { width: value.width/outputScale } : {}) };
}
export function SceneContent({ plan, sourceTimeMs, theme, portrait, variant, outputScale = 1 }: SceneBodyProps & { variant: PlannedScene['scene']['type'] }) {
  const accent = selectThemeColor(theme, 'accent') ?? '#e7bc69';
  const items: { key: string; value: ReactNode; style: CSSProperties }[] = [];
  const { content } = plan.scene;
  if (content.mainText) items.push({ key: 'main', value: content.mainText, style: { fontSize: variant === 'KEYWORD' ? 42 : portrait ? 33 : 38, fontWeight: 800, lineHeight: 1.38, ...editorStyle(plan.mainText,outputScale) } });
  if (content.jpText) items.push({ key: 'jp', value: content.jpText, style: { fontFamily: selectThemeFont(theme,'fontPrimaryJP'), color: accent, fontSize: 28 } });
  if (content.subText) items.push({ key: 'sub', value: content.subText, style: { fontSize: 22, lineHeight: 1.5 } });
  const list = content.emphasis.filter(Boolean);
  list.forEach((value,index) => items.push({ key: `item${index}`, value, style: { padding: '10px 16px', border: `1px solid ${accent}`, borderRadius: variant === 'RELATION' ? 60 : 4, fontSize: 23 } }));
  const mark = variant === 'QUESTION' ? '?' : variant === 'QUOTE_ANALYSIS' ? '“' : variant === 'RECAP' ? '✓' : null;
  return <div data-scene-type={variant} style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 16 }}>
    {mark && <div style={{ color: accent, fontSize: 52, height: 58, lineHeight: 1 }}>{mark}</div>}
    {variant === 'HOOK' && <div style={{ width: 48, height: 4, background: accent }} />}
    {items.map((item,index) => {
      const sampled = samplePlannedSceneMotion(plan, sourceTimeMs, { index, count: items.length });
      if (!sampled.supported || !sampled.values) throw new Error(sampled.diagnostics.map(d => d.code).join(','));
      const v = sampled.values;
      return <div key={item.key} style={{ opacity: v.opacity, translate: `${v.translateX*100}% ${v.translateY*100}%`, scale: v.scale, maxWidth: '100%' }}><div style={item.style}>{item.value}</div></div>;
    })}
    {variant === 'CONCEPT' && <svg width="112" height="32" viewBox="0 0 112 32" aria-hidden><path d="M8 16h96M56 3v26" stroke={accent} strokeWidth="3"/><circle cx="8" cy="16" r="5" fill={accent}/><circle cx="104" cy="16" r="5" fill={accent}/></svg>}
    {content.sourceText && <div style={{ color: selectThemeColor(theme,'muted') ?? '#aaa', fontSize: 13 }}>{content.sourceText}</div>}
  </div>;
}
