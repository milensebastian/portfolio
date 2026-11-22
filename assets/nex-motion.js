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

    function drawMotion(region, dx, dy, expression) {
        const { frame, left, top, weights, eyeWeights, earWeights } = region;
        for (let y = 0; y < frame.height; y++) {
            for (let x = 0; x < frame.width; x++) {
                const index = y * frame.width + x;
                const weight = weights[index];
                let sourceX = left + x - dx * weight;
                let sourceY = top + y - dy * weight;
                if (expression) {
                    const eye = eyeWeights[index];
                    const ear = earWeights[index];
                    sourceX -= expression.eyeX * eye + 12 * expression.ear * ear -
                        expression.roll * (top + y - 132) * weight;
                    sourceY -= expression.eyeY * eye + 4 * expression.ear * ear +
                        expression.roll * (left + x - 137) * weight;
                }
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
    let lastActivity = performance.now();
    let pointer;
    let targetX = 0;
    let targetY = 0;
    let lookX = 0;
    let lookY = 0;
    let earFlick = 0;
    let headDirty = true;

    function eyeWeight(x, y, centerX, centerY) {
        return 1 - fade(Math.hypot((x - centerX) / 19, (y - centerY) / 16), .36, 1);
    }

    function start() {
        if (!context || !image.naturalWidth || pixels) return;
        context.drawImage(image, 0, 0, width, height);
        restingImage = context.getImageData(0, 0, width, height);
        pixels = restingImage.data;
        tail = makeRegion(249, 172, 360, 401, (x, y) =>
            fade(x, 249, 269) * band(y, 173, 205, 262, 400));
        paw = makeRegion(132, 254, 196, height, (x, y) =>
            band(x, 132, 150, 174, 195) * fade(y, 255, 380));
        head = makeRegion(0, 0, 249, 253, (x, y) =>
            (1 - fade(y, 174, 252)) * (1 - fade(x, 232, 248)));
        head.eyeWeights = head.weights.map((_, index) => {
            const x = index % head.frame.width;
            const y = Math.floor(index / head.frame.width);
            return Math.max(eyeWeight(x, y, 96, 124), eyeWeight(x, y, 172, 136));
        });
        head.earWeights = head.weights.map((_, index) => {
            const x = index % head.frame.width;
            const y = Math.floor(index / head.frame.width);
            return band(x, 16, 34, 99, 144) * (1 - fade(y, 12, 110));
        });
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
                headDirty = true;
                pose.fresh = false;
            }
            const progress = Math.min((now - pose.startedAt) / pose.duration, 1);
            pose.render(progress);
            if (progress === 1) pose = undefined;
        }

        renderHead();
        const phase = now * 2 * Math.PI / 3200;
        const energy = 1 - .7 * sleepDepth;
        // The larger part of the swing goes inward, where the art has room.
        drawMotion(tail, (17 * Math.sin(phase) - 10) * energy, 13 * Math.sin(phase + .7) * energy);
    }

    function renderHead() {
        const wantedX = targetX * (1 - sleepDepth);
        const wantedY = targetY * (1 - sleepDepth);
        const nextX = Math.abs(wantedX - lookX) < .003 ? wantedX : lookX + (wantedX - lookX) * .28;
        const nextY = Math.abs(wantedY - lookY) < .003 ? wantedY : lookY + (wantedY - lookY) * .28;
        if (!headDirty && nextX === lookX && nextY === lookY) return;
        lookX = nextX;
        lookY = nextY;
        headDirty = false;

        const dx = lookX * 2.6;
        const lookingDown = lookY > 0;
        const dy = lookY * (lookingDown ? 4 : 1.8) + sleepDepth * 9;
        const roll = lookX * .033;
        const eyeY = lookY * (lookingDown ? 6.4 : 4.8);
        drawMotion(head, dx, dy, { eyeX: lookX * 6.8, eyeY, ear: earFlick, roll });
        eyelids.style.transform = `translate(${100 * dx / width}%, ${100 * dy / height}%) rotate(${roll}rad)`;
    }

    function aimAtPointer() {
        if (!visible || !pointer) return;
        const rect = cat.getBoundingClientRect();
        const eyeLine = rect.top + rect.height * .31;
        const dx = pointer.x - (rect.left + rect.width * .38);
        const dy = pointer.y - eyeLine;
        const downRange = Math.max(28, Math.min(72, (window.innerHeight - eyeLine) * .55));
        const horizontal = Math.tanh(dx / 180);
        const vertical = Math.tanh(dy / (dy > 0 ? downRange : 150));
        const distance = Math.max(1, Math.hypot(horizontal, vertical));
        targetX = horizontal / distance;
        targetY = vertical / distance;
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
                    earFlick = Math.sin(progress * 2 * Math.PI) * Math.sin(progress * Math.PI);
                    headDirty = true;
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
        function checkSleep() {
            const remaining = 60000 - (performance.now() - lastActivity);
            if (remaining > 0) sleepTimer = window.setTimeout(checkSleep, remaining);
            else setSleeping(true);
        }
        sleepTimer = window.setTimeout(checkSleep, Math.max(0, 60000 - (performance.now() - lastActivity)));
    }

    function setSleeping(value) {
        sleeping = value;
        earFlick = 0;
        cat.classList.toggle('is-sleeping', sleeping);
        cat.setAttribute('aria-label', sleeping ? 'Wake Nex the cat' : 'Pet Nex the cat');
        restartTimers();
        const initialDepth = sleepDepth;
        animate(value ? 1050 : 560, (progress) => {
            sleepDepth = initialDepth + (Number(value) - initialDepth) * ease(progress);
            headDirty = true;
        });
    }

    function greet() {
        if (reducedMotion.matches) return;
        lastActivity = performance.now();
        if (sleeping) {
            setSleeping(false);
            return;
        }
        if (cat.classList.contains('is-petted')) return;
        cat.classList.add('is-petted');
        blinkTimer = window.setTimeout(() => cat.classList.remove('is-petted'), 860);
        restartTimers();
        if (!pixels || sleepDepth > 0) return;
        earFlick = 0;
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
            lookX = lookY = targetX = targetY = earFlick = 0;
            clearTimeout(blinkTimer);
            cat.classList.remove('is-sleeping', 'is-petted');
            cat.setAttribute('aria-label', 'Pet Nex the cat');
            hideCanvas();
        } else if (pixels && !frameRequest) {
            lastActivity = performance.now();
            aimAtPointer();
            context.putImageData(restingImage, 0, 0);
            headDirty = true;
            canvas.hidden = false;
            portrait.classList.add('is-animated');
            frameRequest = requestAnimationFrame(tick);
        }
        restartTimers();
    }

    cat.addEventListener('click', greet);
    window.addEventListener('pointermove', (event) => {
        if (event.pointerType !== 'mouse' || (pointer?.x === event.clientX && pointer.y === event.clientY)) return;
        pointer = { x: event.clientX, y: event.clientY };
        if (!visible || reducedMotion.matches) return;
        lastActivity = performance.now();
        aimAtPointer();
        if (sleeping) setSleeping(false);
    }, { passive: true });
    function releaseGaze() {
        pointer = undefined;
        targetX = targetY = 0;
    }
    document.documentElement.addEventListener('pointerleave', releaseGaze);
    window.addEventListener('blur', releaseGaze);
    window.addEventListener('scroll', aimAtPointer, { passive: true });
    window.addEventListener('resize', aimAtPointer);
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
