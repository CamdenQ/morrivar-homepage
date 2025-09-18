(function () {
    const body = document.body;
    const toggle = document.getElementById('themeToggle');
    const newsletterForm = document.getElementById('newsletterForm');
    const successMessage = document.getElementById('formSuccess');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
    const twitterContainer = document.querySelector('.social-cta--twitter');
    const tumblrButtonFrame = document.querySelector('.social-cta--tumblr iframe');
    const TUMBLR_SCALE = 1.4;

    const storedTheme = localStorage.getItem('morrivar-theme');
    if (storedTheme) {
        applyTheme(storedTheme);
    } else {
        applyTheme(prefersDark.matches ? 'dark' : 'light');
    }

    prefersDark.addEventListener('change', (event) => {
        if (!localStorage.getItem('morrivar-theme')) {
            applyTheme(event.matches ? 'dark' : 'light');
        }
    });

    if (toggle) {
        toggle.addEventListener('click', () => {
            const nextTheme = body.dataset.theme === 'light' ? 'dark' : 'light';
            applyTheme(nextTheme);
            localStorage.setItem('morrivar-theme', nextTheme);
        });
    }

    if (newsletterForm && successMessage) {
        newsletterForm.addEventListener('submit', (event) => {
            event.preventDefault();
            const email = newsletterForm.email.value.trim();

            if (!email) {
                successMessage.textContent = 'Drop an email to join the dispatch.';
                successMessage.style.color = 'var(--accent)';
                return;
            }

            successMessage.textContent = "You're locked in. Watch your inbox for the next dispatch.";
            successMessage.style.color = 'var(--accent)';
            newsletterForm.reset();
        });
    }

    const yearElement = document.getElementById('year');
    if (yearElement) {
        yearElement.textContent = new Date().getFullYear();
    }

    if (tumblrButtonFrame) {
        tumblrButtonFrame.addEventListener('load', styleTumblrButton);
        // Fallback in case the load event ran before this script executed.
        setTimeout(styleTumblrButton, 300);
    }

    function applyTheme(theme) {
        const applied = theme === 'dark' ? 'dark' : 'light';
        body.dataset.theme = applied;
        refreshSocialEmbeds(applied);
    }

    function refreshSocialEmbeds(theme) {
        if (twitterContainer) {
            buildTwitterButton(theme);
        }

        if (tumblrButtonFrame) {
            const baseSrc = tumblrButtonFrame.dataset.baseSrc || tumblrButtonFrame.src;

            try {
                const tumblrUrl = new URL(baseSrc);
                const tint = theme === 'dark' ? 'black' : 'blue';
                tumblrUrl.searchParams.set('color', tint);
                const nextSrc = tumblrUrl.toString();

                if (tumblrButtonFrame.src !== nextSrc) {
                    tumblrButtonFrame.src = nextSrc;
                } else {
                    styleTumblrButton();
                }
            } catch (error) {
                // Ignore URL errors in non-browser environments.
            }
        }
    }

    function buildTwitterButton(theme) {
        if (!twitterContainer) {
            return;
        }

        const handle = twitterContainer.dataset.twitterHandle;

        if (!handle) {
            return;
        }

        if (!window.twttr || !window.twttr.widgets || typeof window.twttr.widgets.createFollowButton !== 'function') {
            setTimeout(() => buildTwitterButton(theme), 150);
            return;
        }

        twitterContainer.innerHTML = '';
        window.twttr.widgets.createFollowButton(handle, twitterContainer, {
            size: 'large',
            showCount: false,
            dnt: true,
            theme: theme === 'dark' ? 'dark' : 'light'
        }).then(styleTwitterButton);
    }

    function styleTwitterButton() {
        if (!twitterContainer) {
            return;
        }

        const iframe = twitterContainer.querySelector('iframe');

        if (!iframe) {
            return;
        }

        iframe.style.background = 'transparent';
        iframe.style.border = '0';
        iframe.style.borderRadius = '9999px';
        twitterContainer.style.borderRadius = '9999px';
        twitterContainer.style.overflow = 'hidden';
    }

    function styleTumblrButton() {
        if (!tumblrButtonFrame) {
            return;
        }

        const container = tumblrButtonFrame.parentElement;
        if (!container) {
            return;
        }

        const baseWidth = parseFloat(tumblrButtonFrame.dataset.baseWidth) || tumblrButtonFrame.offsetWidth;
        const baseHeight = parseFloat(tumblrButtonFrame.dataset.baseHeight) || tumblrButtonFrame.offsetHeight;

        if (!baseWidth || !baseHeight) {
            return;
        }

        tumblrButtonFrame.dataset.baseWidth = baseWidth;
        tumblrButtonFrame.dataset.baseHeight = baseHeight;

        const scaledWidth = Math.round(baseWidth * TUMBLR_SCALE);
        const scaledHeight = Math.round(baseHeight * TUMBLR_SCALE);

        tumblrButtonFrame.style.transform = `scale(${TUMBLR_SCALE})`;
        tumblrButtonFrame.style.transformOrigin = 'left center';
        tumblrButtonFrame.style.background = 'transparent';
        tumblrButtonFrame.style.border = '0';
        tumblrButtonFrame.style.width = `${baseWidth}px`;
        tumblrButtonFrame.style.height = `${baseHeight}px`;

        container.style.width = `${scaledWidth}px`;
        container.style.height = `${scaledHeight}px`;
        container.style.borderRadius = '9999px';
        container.style.overflow = 'hidden';
    }
})();
