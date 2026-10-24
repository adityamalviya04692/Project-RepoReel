import { useId } from 'react';

/* The RepoReel mark: the Instagram-identity gradient tile with one white glyph, a git commit line
   (the repo) that forms the back edge of a play button (the reel). */
export default function Logo({ size = 28 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}g`} cx="0.28" cy="1.08" r="1.25">
          <stop offset="0" stopColor="#FFDC80" />
          <stop offset="0.22" stopColor="#F77737" />
          <stop offset="0.5" stopColor="#E1306C" />
          <stop offset="0.72" stopColor="#C13584" />
          <stop offset="1" stopColor="#833AB4" />
        </radialGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id}g)`} />
      <path d="M11 8v16" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M13.4 10.9 22.6 16l-9.2 5.1z" fill="#fff" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="11" cy="8" r="2.4" fill={`url(#${id}g)`} stroke="#fff" strokeWidth="1.9" />
      <circle cx="11" cy="24" r="2.4" fill={`url(#${id}g)`} stroke="#fff" strokeWidth="1.9" />
    </svg>
  );
}
