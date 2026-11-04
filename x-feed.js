const HANDLE = 'MorrivarGG';
const validId = value => typeof value === 'string' && /^\d{1,25}$/.test(value);
const decodeText = text => text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}
function link(href, text, className) {
    const node = element('a', className, text);
    node.href = href;
    node.rel = 'noopener noreferrer';
    return node;
}
function safeHttps(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
    } catch { return null; }
}

export function validateFeed(data) {
    if (!data?.profile || data.profile.username?.toLowerCase() !== HANDLE.toLowerCase() || typeof data.profile.name !== 'string') throw new Error('Invalid profile');
    if (!Array.isArray(data.posts)) throw new Error('Invalid posts');
    return data.posts.filter(post => validId(post.id) && typeof post.text === 'string' && post.text.length <= 100000 && Number.isFinite(Date.parse(post.createdAt))).slice(0, 5);
}

function appendPostText(node, post) {
    const urls = new Map((Array.isArray(post.urls) ? post.urls : []).filter(item => typeof item.token === 'string' && /^https:\/\/t\.co\/[A-Za-z0-9]+$/.test(item.token) && safeHttps(item.href)).map(item => [item.token, item]));
    const tokens = post.text.split(/(https:\/\/t\.co\/[A-Za-z0-9]+)/g);
    for (const token of tokens) {
        const url = urls.get(token);
        node.append(url ? link(safeHttps(url.href), decodeText(typeof url.label === 'string' ? url.label : url.href)) : document.createTextNode(decodeText(token)));
    }
}

export function renderFeed(feed, data) {
    const posts = validateFeed(data);
    const profile = data.profile;
    const items = posts.map(post => {
        const article = element('article', 'x-post');
        const header = element('div', 'x-post-heading');
        const author = link(`https://x.com/${HANDLE}`, undefined, 'x-author');
        const avatarUrl = safeHttps(profile.avatar);
        if (avatarUrl && new URL(avatarUrl).hostname === 'pbs.twimg.com') {
            const avatar = element('img', 'x-avatar');
            avatar.src = avatarUrl;
            avatar.alt = '';
            avatar.width = 40;
            avatar.height = 40;
            avatar.loading = 'lazy';
            author.append(avatar);
        }
        const identity = element('span', 'x-identity');
        identity.append(element('strong', '', profile.name), element('span', 'x-handle', `@${HANDLE}`));
        author.append(identity);
        const badge = link(`https://x.com/${HANDLE}/status/${post.id}`, undefined, 'x-post-brand');
        badge.setAttribute('aria-label', 'View post on X');
        const icon = element('span', 'icon icon-x');
        icon.setAttribute('aria-hidden', 'true');
        badge.append(icon);
        header.append(author, badge);
        article.append(header);
        if (validId(post.replyTo)) article.append(link(`https://x.com/i/status/${post.replyTo}`, 'In reply to a post', 'x-reply-context'));
        const text = element('p', 'x-post-text');
        text.dir = 'auto';
        appendPostText(text, post);
        article.append(text);
        if (post.hasMedia) article.append(link(`https://x.com/${HANDLE}/status/${post.id}`, 'View attached media on X', 'x-media-link'));
        const timestamp = element('time');
        timestamp.dateTime = post.createdAt;
        timestamp.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(post.createdAt));
        const permalink = link(`https://x.com/${HANDLE}/status/${post.id}`, undefined, 'x-post-date');
        if (post.edited) permalink.append(document.createTextNode('Edited · '));
        permalink.append(timestamp);
        article.append(permalink);
        const actions = element('div', 'x-post-actions');
        actions.append(
            link(`https://twitter.com/intent/tweet?in_reply_to=${post.id}`, 'Reply'),
            link(`https://twitter.com/intent/retweet?tweet_id=${post.id}`, 'Repost'),
            link(`https://twitter.com/intent/like?tweet_id=${post.id}`, 'Like')
        );
        article.append(actions);
        return article;
    });
    feed.replaceChildren(...(items.length ? items : [link(`https://x.com/${HANDLE}`, `Posts by ${HANDLE}`)]));
    return items.length;
}

export async function loadXFeed() {
    const feed = document.getElementById('xTimeline');
    const status = document.getElementById('xStatus');
    if (!feed || !status) return;
    feed.setAttribute('aria-busy', 'true');
    try {
        const configResponse = await fetch('data/x-feed-config.json', { signal: AbortSignal.timeout(10000) });
        if (!configResponse.ok) throw new Error('No configuration');
        const config = await configResponse.json();
        // Local development uses a local worker. Production requires its deployed URL.
        const endpoint = config.endpoint || (['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://127.0.0.1:8787/api/x-feed' : '');
        if (!endpoint) throw new Error('Feed not connected');
        const target = new URL(endpoint, location.href);
        if (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(target.hostname))) throw new Error('Invalid endpoint');
        const response = await fetch(target, { signal: AbortSignal.timeout(10000), credentials: 'omit' });
        if (!response.ok) throw new Error('Feed unavailable');
        const data = await response.json();
        const count = data.profile ? renderFeed(feed, data) : 0;
        if (!data.profile) feed.replaceChildren(link(`https://x.com/${HANDLE}`, `Posts by ${HANDLE}`));
        status.textContent = count ? 'Posts and replies from @MorrivarGG.' : 'Posts are available on X.';
    } catch {
        status.textContent = 'Posts are available on X.';
    } finally { feed.setAttribute('aria-busy', 'false'); }
}

if (typeof document !== 'undefined') loadXFeed();
