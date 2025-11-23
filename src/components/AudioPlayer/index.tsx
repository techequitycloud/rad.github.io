import React from 'react';
import styles from './styles.module.css';

interface AudioPlayerProps {
  url: string;
  title?: string;
}

export default function AudioPlayer({url, title = 'Audio Guide'}: AudioPlayerProps): JSX.Element {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.icon}>🎧</span>
        <h3 className={styles.title}>{title}</h3>
      </div>
      <audio controls className={styles.audio}>
        <source src={url} type="audio/mp4" />
        <source src={url} type="audio/x-m4a" />
        Your browser does not support the audio element.
      </audio>
    </div>
  );
}
