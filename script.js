(() => {
    'use strict';
    const root = document.documentElement;
    const toggle = document.getElementById('themeToggle');
    const preference = window.matchMedia('(prefers-color-scheme: light)');
    let chosenTheme = readTheme();

    function readTheme() {
        try {
            const value = localStorage.getItem('morrivar-theme');
            return value === 'dark' || value === 'light' ? value : null;
        } catch (_) { return null; }
    }
    function applyTheme(theme) {
        root.dataset.theme = theme;
        toggle.setAttribute('aria-label', theme === 'dark' ? 'Use light theme' : 'Use dark theme');
        toggle.setAttribute('aria-pressed', String(theme === 'light'));
    }
    applyTheme(chosenTheme || (preference.matches ? 'light' : 'dark'));
    toggle.addEventListener('click', () => {
        chosenTheme = root.dataset.theme === 'dark' ? 'light' : 'dark';
        applyTheme(chosenTheme);
        try { localStorage.setItem('morrivar-theme', chosenTheme); } catch (_) { /* Switch for this visit. */ }
    });
    preference.addEventListener('change', event => {
        if (!chosenTheme) {
            applyTheme(event.matches ? 'light' : 'dark');
        }
    });
    document.getElementById('year').textContent = new Date().getFullYear();

    function icon(name) {
        const element = document.createElement('span');
        element.className = `icon icon-${name}`;
        element.setAttribute('aria-hidden', 'true');
        return element;
    }
    function videoCard(video, featured = false) {
        const link = document.createElement('a');
        link.className = `video-card${featured ? ' featured' : ''}`;
        link.href = `https://www.youtube.com/watch?v=${video.id}`;
        const imageBox = document.createElement('div');
        imageBox.className = 'video-image';
        const image = document.createElement('img');
        image.src = `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;
        image.alt = '';
        image.width = 480;
        image.height = 270;
        image.loading = 'lazy';
        const play = document.createElement('span');
        play.className = 'play-button';
        play.append(icon('play'));
        imageBox.append(image, play);
        const title = document.createElement('h3');
        title.textContent = video.title;
        link.append(imageBox, title);
        return link;
    }
    async function loadVideos() {
        const feed = document.getElementById('youtubeFeed');
        const status = document.getElementById('youtubeStatus');
        status.textContent = 'Loading videos…';
        try {
            const response = await fetch('data/youtube.json', { signal: AbortSignal.timeout(10000) });
            if (!response.ok) throw new Error(`Video feed: ${response.status}`);
            const data = await response.json();
            const videos = Array.isArray(data.videos) ? data.videos.filter(video =>
                /^[A-Za-z0-9_-]{11}$/.test(video.id) && typeof video.title === 'string' && video.title.trim()
            ).slice(0, 3) : [];
            if (!videos.length) throw new Error('No public videos');
            const more = document.createElement('div');
            more.className = 'video-more';
            videos.slice(1).forEach(video => more.append(videoCard(video)));
            feed.replaceChildren(videoCard(videos[0], true), more);
        } catch (_) {
            status.textContent = 'Videos are available on the channel.';
        } finally { feed.setAttribute('aria-busy', 'false'); }
    }
    loadVideos();
})();
