import React, { useState } from 'react';

export interface VideoItem {
  title: string;
  url: string;
}

interface VideoGalleryProps {
  videos: VideoItem[];
}

function VideoCard({ video }: { video: VideoItem }) {
  const [playing, setPlaying] = useState(false);
  const isYouTube = video.url.includes('youtube.com/embed');
  const videoId = isYouTube ? video.url.split('/embed/')[1]?.split('?')[0] : null;
  const thumbnailUrl = videoId
    ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
    : undefined;

  return (
    <div style={{
      border: '1px solid var(--ifm-color-emphasis-200)',
      borderRadius: 'var(--ifm-card-border-radius)',
      overflow: 'hidden',
      backgroundColor: 'var(--ifm-card-background-color)',
      boxShadow: 'var(--ifm-global-shadow-lw)',
      display: 'flex',
      flexDirection: 'column'
    }}>
      <div style={{ position: 'relative', width: '100%', paddingTop: '56.25%' }}>
        {isYouTube ? (
          playing ? (
            <iframe
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
              src={`${video.url}?autoplay=1`}
              title={video.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <div
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', cursor: 'pointer' }}
              onClick={() => setPlaying(true)}
              role="button"
              aria-label={`Play ${video.title}`}
            >
              <img
                src={thumbnailUrl}
                alt={video.title}
                style={{ width: '100%', height: '100%', objectFit: 'cover', backgroundColor: '#000' }}
              />
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '68px',
                height: '48px',
                backgroundColor: 'rgba(255, 0, 0, 0.9)',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <div style={{
                  width: 0,
                  height: 0,
                  borderTop: '12px solid transparent',
                  borderBottom: '12px solid transparent',
                  borderLeft: '20px solid white',
                  marginLeft: '4px',
                }} />
              </div>
            </div>
          )
        ) : (
          <video
            controls
            preload="metadata"
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: '#000' }}
          >
            <source src={video.url} type="video/mp4" />
            Your browser does not support the video tag.
          </video>
        )}
      </div>
      <div style={{ padding: '1rem' }}>
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
  );
}

export default function VideoGallery({ videos }: VideoGalleryProps): JSX.Element {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
      gap: '2rem',
      padding: '2rem 0'
    }}>
      {videos.map((video, idx) => (
        <VideoCard key={idx} video={video} />
      ))}
    </div>
  );
}
