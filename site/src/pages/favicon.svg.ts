import svg from '../../../apps/kira-studio/build/appicon.icon/Assets/kira_icon_vector.svg?raw';

export function GET() {
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml' } });
}
