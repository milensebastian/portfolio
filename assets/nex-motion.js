(() => {
    const cat = document.getElementById('cyber-cat-container');
    const portrait = cat.querySelector('.cat-portrait');
    const image = portrait.querySelector('img');
    const canvas = portrait.querySelector('canvas');
    const eyelids = portrait.querySelector('.cat-eyelids');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const { width, height } = canvas;

    const ease = (progress) => {
        const value = Math.max(0, Math.min(progress, 1));
        return value * value * (3 - 2 * value);
    };
    const fade = (value, from, to) => ease((value - from) / (to - from));
    const band = (value, from, fullFrom, fullTo, to) =>
        fade(value, from, fullFrom) * (1 - fade(value, fullTo, to));

    // The weights taper into the surrounding fur. The paws and tail base
    // outside the affected region always use the original illustration.
    function makeRegion(left, top, right, bottom, weightAt) {
        const frame = context.createImageData(right - left, bottom - top);
        const weights = new Float32Array(frame.width * frame.height);
        for (let y = 0; y < frame.height; y++) {
            for (let x = 0; x < frame.width; x++) {
                weights[y * frame.width + x] = weightAt(left + x, top + y);
            }
        }
        return { left, top, frame, weights };
    }

    function drawMotion(region, dx, dy) {
        const { frame, left, top, weights } = region;
        for (let y = 0; y < frame.height; y++) {
            for (let x = 0; x < frame.width; x++) {
                const index = y * frame.width + x;
                const weight = weights[index];
                const sourceX = left + x - dx * weight;
                const sourceY = top + y - dy * weight;
                const x0 = Math.floor(sourceX);
                const y0 = Math.floor(sourceY);
                const fracX = sourceX - x0;
                const fracY = sourceY - y0;
                const out = index * 4;
                for (let channel = 0; channel < 4; channel++) {
                    const a = sample(x0, y0, channel);
                    const b = sample(x0 + 1, y0, channel);
                    const c = sample(x0, y0 + 1, channel);
                    const d = sample(x0 + 1, y0 + 1, channel);
                    const upper = a + (b - a) * fracX;
                    const lower = c + (d - c) * fracX;
                    frame.data[out + channel] = upper + (lower - upper) * fracY;
                }
            }
        }
        context.putImageData(frame, left, top);
    }

    function sample(x, y, channel) {
        if (x < 0 || x >= width || y < 0 || y >= height) return 0;
        return pixels[(y * width + x) * 4 + channel];
    }

    function drawRaisedPaw(dx, lift) {
        drawMotion(paw, dx, -34 * lift);
        if (lift === 0) return;

        // Fill the area behind the raised paw with fur from the back leg.
        // The curved lower edge leaves the lifted paw clear of the floor.
        context.save();
        context.globalCompositeOperation = 'destination-over';
        context.beginPath();
        context.moveTo(136, 374);
        context.bezierCurveTo(151, 363, 178, 365, 190, 376);
        context.bezierCurveTo(193, 387, 190, 401, 183, 407);
        context.bezierCurveTo(174, 411, 151, 412, 141, 405);
        context.bezierCurveTo(137, 397, 135, 385, 136, 374);
        context.clip();
        context.drawImage(image, 184, 327, 35, 53, 134, 365, 61, 48);
        context.restore();
    }

    let pixels;
    let ear;
    let tail;
    let paw;
    let head;
    let restingImage;
    let visible = false;
    let sleeping = false;
    let sleepDepth = 0;
    let frameRequest = 0;
    let lastPaint = 0;
    let pose;
    let idleTimer;
    let sleepTimer;
    let blinkTimer;

    function start() {
        if (!context || !image.naturalWidth || pixels) return;
        context.drawImage(image, 0, 0, width, height);
        restingImage = context.getImageData(0, 0, width, height);
        pixels = restingImage.data;
        ear = makeRegion(15, 0, 145, 111, (x, y) =>
            band(x, 16, 34, 99, 144) * (1 - fade(y, 12, 110)));
        tail = makeRegion(249, 190, 360, 386, (x, y) =>
            fade(x, 250, 271) * band(y, 191, 216, 250, 385));
        paw = makeRegion(132, 254, 196, height, (x, y) =>
            band(x, 132, 150, 174, 195) * fade(y, 255, 380));
        head = makeRegion(0, 0, 249, 253, (x, y) =>
            (1 - fade(y, 174, 252)) * (1 - fade(x, 232, 248)));
        updateActivity();
    }

    function animate(duration, render) {
        pose = { duration, render, startedAt: performance.now(), fresh: true };
    }

    function tick(now) {
        frameRequest = requestAnimationFrame(tick);
        if (now - lastPaint < 32) return;
        lastPaint = now;

        if (pose) {
            if (pose.fresh) {
                context.putImageData(restingImage, 0, 0);
                pose.fresh = false;
            }
            const progress = Math.min((now - pose.startedAt) / pose.duration, 1);
            pose.render(progress);
            if (progress === 1) pose = undefined;
        }

        const phase = now * 2 * Math.PI / 4200;
        const energy = 1 - .7 * sleepDepth;
        drawMotion(tail, Math.sin(phase) * 9 * energy, Math.sin(phase + .7) * 5 * energy);
    }

    function hideCanvas() {
        canvas.hidden = true;
        portrait.classList.remove('is-animated');
        eyelids.style.transform = '';
    }

    function scheduleIdle() {
        idleTimer = window.setTimeout(() => {
            if (!pose) {
                animate(460, (progress) => {
                    const flick = Math.sin(progress * 2 * Math.PI) * Math.sin(progress * Math.PI);
                    drawMotion(ear, flick * 12, flick * 4);
                });
            }
            scheduleIdle();
        }, 7000 + Math.random() * 8000);
    }

    function restartTimers() {
        clearTimeout(idleTimer);
        clearTimeout(sleepTimer);
        if (!pixels || !visible || document.hidden || reducedMotion.matches || sleeping) return;
        scheduleIdle();
        sleepTimer = window.setTimeout(() => setSleeping(true), 60000);
    }

    function setSleeping(value) {
        sleeping = value;
        cat.classList.toggle('is-sleeping', sleeping);
        cat.setAttribute('aria-label', sleeping ? 'Wake Nex the cat' : 'Pet Nex the cat');
        restartTimers();
        const initialDepth = sleepDepth;
        animate(value ? 1050 : 560, (progress) => {
            sleepDepth = initialDepth + (Number(value) - initialDepth) * ease(progress);
            const drop = 9 * sleepDepth;
            drawMotion(head, 0, drop);
            eyelids.style.transform = `translateY(${100 * drop / height}%)`;
        });
    }

    function greet() {
        if (reducedMotion.matches) return;
        if (sleeping) {
            setSleeping(false);
            return;
        }
        if (cat.classList.contains('is-petted')) return;
        cat.classList.add('is-petted');
        blinkTimer = window.setTimeout(() => cat.classList.remove('is-petted'), 860);
        restartTimers();
        if (!pixels || sleepDepth > 0) return;
        animate(1200, (progress) => {
            const lift = fade(progress, 0, .27) * (1 - fade(progress, .72, 1));
            const wave = Math.sin(fade(progress, .25, .74) * 4 * Math.PI);
            drawRaisedPaw(wave * 4 * lift, lift);
        });
    }

    function updateActivity() {
        if (!visible || document.hidden || reducedMotion.matches) {
            cancelAnimationFrame(frameRequest);
            frameRequest = 0;
            pose = undefined;
            sleepDepth = 0;
            sleeping = false;
            clearTimeout(blinkTimer);
            cat.classList.remove('is-sleeping', 'is-petted');
            cat.setAttribute('aria-label', 'Pet Nex the cat');
            hideCanvas();
        } else if (pixels && !frameRequest) {
            context.putImageData(restingImage, 0, 0);
            canvas.hidden = false;
            portrait.classList.add('is-animated');
            frameRequest = requestAnimationFrame(tick);
        }
        restartTimers();
    }

    cat.addEventListener('click', greet);
    document.addEventListener('visibilitychange', updateActivity);
    reducedMotion.addEventListener('change', updateActivity);
    new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        updateActivity();
    }).observe(cat);

    let meowKeys = '';
    window.addEventListener('keydown', (event) => {
        if (!visible || event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
        if (event.target.closest?.('input, textarea, select, [contenteditable]')) return;
        meowKeys = (meowKeys + event.key.toLowerCase()).slice(-4);
        if (meowKeys !== 'meow') return;
        meowKeys = '';
        greet();
    });

    if (image.complete) start();
    else image.addEventListener('load', start, { once: true });
})();
