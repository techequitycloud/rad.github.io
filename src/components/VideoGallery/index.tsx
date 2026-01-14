import React from 'react';

export interface VideoItem {
  title: string;
  url: string;
}

interface VideoGalleryProps {
  videos: VideoItem[];
}

export default function VideoGallery({videos}: VideoGalleryProps): JSX.Element {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
      gap: '2rem',
      padding: '2rem 0'
    }}>
      {videos.map((video, idx) => (
        <div key={idx} style={{
          border: '1px solid var(--ifm-color-emphasis-200)',
          borderRadius: 'var(--ifm-card-border-radius)',
          overflow: 'hidden',
          backgroundColor: 'var(--ifm-card-background-color)',
          boxShadow: 'var(--ifm-global-shadow-lw)',
          display: 'flex',
          flexDirection: 'column'
        }}>
          <div style={{position: 'relative', width: '100%', paddingTop: '56.25%' /* 16:9 Aspect Ratio */}}>
            <video
              controls
              preload="metadata"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                backgroundColor: '#000'
              }}
            >
              <source src={video.url} type="video/mp4" />
              Your browser does not support the video tag.
            </video>
          </div>
          <div style={{padding: '1rem'}}>
            <h3 style={{
              margin: 0,
              fontSize: '1rem',
              fontWeight: 600,
              color: 'var(--ifm-color-content)'
            }}>
              {video.title}
            </h3>
          </div>
        </div>
      ))}
    </div>
  );
}
