import React, { useState } from 'react';

export interface DemoVideo {
  title: string;
  url: string;
  poster: string;
}

export interface DemoSection {
  title: string;
  videos: DemoVideo[];
}

interface DemoPlayerProps {
  sections: DemoSection[];
}

export default function DemoPlayer({ sections }: DemoPlayerProps): JSX.Element {
  const allVideos = sections.flatMap(s => s.videos);
  const [selected, setSelected] = useState<DemoVideo>(allVideos[0]);

  return (
    <div>
      {/* Section navigation */}
      <div style={{ marginBottom: '1.5rem' }}>
        {sections.map((section, si) => (
          <div key={si} style={{ marginBottom: '1.25rem' }}>
            <h3 style={{
              borderLeft: '4px solid var(--ifm-color-primary)',
              paddingLeft: '0.75rem',
              marginBottom: '0.75rem',
              fontSize: '1.1rem',
              fontWeight: 700,
            }}>
              {section.title}
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {section.videos.map((video, vi) => {
                const isActive = selected.url === video.url;
                return (
                  <button
                    key={vi}
                    onClick={() => setSelected(video)}
                    style={{
                      padding: '0.5rem 1rem',
                      borderRadius: '0.5rem',
                      border: `1px solid ${isActive ? 'var(--ifm-color-primary)' : 'var(--ifm-color-emphasis-300)'}`,
                      backgroundColor: isActive
                        ? 'var(--ifm-color-primary)'
                        : 'var(--ifm-card-background-color)',
                      color: isActive ? '#fff' : 'var(--ifm-color-content)',
                      cursor: 'pointer',
                      fontSize: '0.875rem',
                      fontWeight: isActive ? 600 : 400,
                      transition: 'background-color 0.15s ease, border-color 0.15s ease',
                      boxShadow: 'var(--ifm-global-shadow-lw)',
                    }}
                  >
                    {video.title}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Video player */}
      <div style={{
        border: '1px solid var(--ifm-color-emphasis-200)',
        borderRadius: 'var(--ifm-card-border-radius)',
        overflow: 'hidden',
        backgroundColor: '#000',
      }}>
        <video
          key={selected.url}
          controls
          width="100%"
          poster={selected.poster}
          style={{ display: 'block' }}
        >
          <source src={selected.url} type="video/mp4" />
          Your browser does not support the video tag.
        </video>
      </div>
      <p style={{
        textAlign: 'center',
        marginTop: '0.75rem',
        fontWeight: 600,
        color: 'var(--ifm-color-content)',
      }}>
        {selected.title}
      </p>
    </div>
  );
}
