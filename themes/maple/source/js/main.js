// mobile menu
function registerMobileMenu() {
  $("#open-menu").click(function () {
    // set height auto
    $("#menu-panel").css("height", "auto");
    // set translate y 0
    $("#menu-content").css(
      "transform",
      "translate(0, 0) rotate(0) skew(0) scaleX(1) scaleY(1)"
    );
    $("#open-menu").css("display", "none");
    $("#close-menu").css("display", "block");
  });

  $("#close-menu").click(function () {
    // set height 0
    $("#menu-panel").css("height", "0");
    // set translate y -100%
    $("#menu-content").css(
      "transform",
      "translate(0, -100%) rotate(0) skew(0) scaleX(1) scaleY(1)"
    );
    $("#open-menu").css("display", "block");
    $("#close-menu").css("display", "none");
  });
}

// header page title
function registerHeaderPageTitle() {
  // 监听文章标题消失时，在header中显示文章标题
  new IntersectionObserver((entries) => {
    if (entries[0].intersectionRatio <= 0) {
      $("#header-title")
        .css("opacity", "1")
        .css("transform", "translate(0, 0)")
        .css("transition", "all 0.3s");
    } else {
      $("#header-title")
        .css("opacity", "0")
        .css("transform", "translate(0, -100%)")
        .css("transition", "all 0.3s");
    }
  }).observe($("#article-title")[0], {
    threshold: 0,
  });
}

// go top
function registerGoTop() {
  const THRESHOLD = 50;
  const $top = $('.back-to-top');
  $(window).scroll(function () {
    $top.toggleClass('back-to-top-on', window.pageYOffset > THRESHOLD);
    const scrollTop = $(window).scrollTop();
    const docHeight = $('#content').height();
    const winHeight = $(window).height();
    const contentVisibilityHeight = (docHeight > winHeight) ? (docHeight - winHeight) : ($(document).height() - winHeight);
    const scrollPercent = (scrollTop) / (contentVisibilityHeight);
    const scrollPercentRounded = Math.round(scrollPercent*100);
    const scrollPercentMaxed = (scrollPercentRounded > 100) ? 100 : scrollPercentRounded;
    $('#scrollpercent>span').html(scrollPercentMaxed);
  });

  $top.on('click', function () {
    $('body').velocity('scroll');
  });
}

function registerSharePost() {
  const rootEl = document.getElementById("share-post");
  if (!rootEl) return;
  const container = document.getElementById("share-buttons-container");
  if (!container) return;

  const platforms = JSON.parse(rootEl.dataset.platforms || "{}");
  const qrApiBase =
    rootEl.dataset.qrApiBase || "https://api.qrserver.com/v1/create-qr-code/";

  const i18n = {
    copyLink: rootEl.dataset.i18nCopyLink || "Copy link",
    linkCopied: rootEl.dataset.i18nLinkCopied || "Link copied",
    copyFailed: rootEl.dataset.i18nCopyFailed || "Copy failed",
    wechat: rootEl.dataset.i18nWechat || "WeChat",
    wechatQrTip: rootEl.dataset.i18nWechatQrTip || "Scan to share",
    close: rootEl.dataset.i18nClose || "Close",
  };

  const toastEl = document.getElementById("share-toast");
  const modalEl = document.getElementById("share-modal");
  const modalCloseEl = document.getElementById("share-modal-close");
  const modalQrEl = document.getElementById("share-modal-qr");

  let toastTimer = null;
  function showToast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.remove("hidden");
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toastEl.classList.add("hidden");
    }, 1600);
  }

  function openModal() {
    if (!modalEl) return;
    modalEl.classList.remove("hidden");
    modalEl.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }
  function closeModal() {
    if (!modalEl) return;
    modalEl.classList.add("hidden");
    modalEl.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  if (modalEl) {
    modalEl.addEventListener("click", (e) => {
      if (e.target === modalEl || (e.target && e.target.classList && e.target.classList.contains("bg-black/40"))) {
        closeModal();
      }
    });
  }
  if (modalCloseEl) modalCloseEl.addEventListener("click", closeModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {}
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  function createAction({
    label,
    icon,
    href,
    onClick,
  }) {
    const el = document.createElement(href ? "a" : "button");
    el.className =
      "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium " +
      "border border-gray-200 text-gray-600 hover:bg-gray-50 " +
      "dark:border-zinc-700 dark:text-gray-200 dark:hover:bg-zinc-800/60";
    if (href) {
      el.href = href;
      el.target = "_blank";
      el.rel = "noopener noreferrer";
    } else {
      el.type = "button";
    }

    const iconEl = document.createElement("iconify-icon");
    iconEl.setAttribute("width", "16");
    iconEl.setAttribute("icon", icon);
    el.appendChild(iconEl);

    const textEl = document.createElement("span");
    textEl.textContent = label;
    el.appendChild(textEl);

    if (onClick) el.addEventListener("click", onClick);
    container.appendChild(el);
  }

  const pageUrl = encodeURIComponent(window.location.href);
  const pageTitle = encodeURIComponent(document.title);

  if (platforms.twitter) {
    createAction({
      label: "X",
      icon: "ri:twitter-x-line",
      href: `https://twitter.com/intent/tweet?text=${pageTitle}&url=${pageUrl}`,
    });
  }
  if (platforms.linkedin) {
    createAction({
      label: "LinkedIn",
      icon: "ri:linkedin-box-line",
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${pageUrl}`,
    });
  }
  if (platforms.facebook) {
    createAction({
      label: "Facebook",
      icon: "ri:facebook-box-line",
      href: `https://www.facebook.com/sharer/sharer.php?u=${pageUrl}`,
    });
  }
  if (platforms.reddit) {
    createAction({
      label: "Reddit",
      icon: "ri:reddit-line",
      href: `https://www.reddit.com/submit?url=${pageUrl}&title=${pageTitle}`,
    });
  }
  if (platforms.weibo) {
    createAction({
      label: "Weibo",
      icon: "ri:weibo-line",
      href: `https://service.weibo.com/share/share.php?title=${pageTitle}&url=${pageUrl}`,
    });
  }
  if (platforms.qq) {
    createAction({
      label: "QQ",
      icon: "ri:qq-line",
      href: `https://connect.qq.com/widget/shareqq/index.html?title=${pageTitle}&url=${pageUrl}`,
    });
  }
  if (platforms.wechat) {
    createAction({
      label: i18n.wechat,
      icon: "ri:wechat-line",
      onClick: (e) => {
        e.preventDefault();
        if (modalQrEl) {
          const qrUrl =
            `${qrApiBase}?size=150x150&data=${encodeURIComponent(window.location.href)}`;
          modalQrEl.src = qrUrl;
          modalQrEl.alt = i18n.wechatQrTip;
        }
        openModal();
      },
    });
  }

  createAction({
    label: i18n.copyLink,
    icon: "carbon:copy",
    onClick: async (e) => {
      e.preventDefault();
      const ok = await copyText(window.location.href);
      showToast(ok ? i18n.linkCopied : i18n.copyFailed);
    },
  });
}

// copy code
function registerCopyCode() {
  $("figure.highlight").each(function () {
    const copyIcon = $(
      "<iconify-icon id='copy-icon' width='18' icon='carbon:copy'></iconify-icon>"
    );
    const leftOffset = 25;
    // left
    const left = $(this).width() - leftOffset;
    // set style
    $(copyIcon).css("position", "absolute");
    $(copyIcon).css("left", `${left}px`);
    $(copyIcon).css("top", "15px");
    $(copyIcon).css("cursor", "pointer");
    // add icon
    $(this).append(copyIcon);
    // copy code
    $(copyIcon).click(function () {
      // .code .line
      const code = [...$(this).parent().find(".code .line")]
        .map((line) => line.innerText)
        .join("\n");
      // begin copy
      const textarea = document.createElement("textarea");
      textarea.value = code;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      var ta = document.createElement("textarea");
      ta.style.top = window.scrollY + "px"; // Prevent page scrolling
      ta.style.position = "absolute";
      ta.style.opacity = "0";
      ta.readOnly = true;
      ta.value = code;
      document.body.append(ta);
      const selection = document.getSelection();
      const selected =
        selection.rangeCount > 0 ? selection.getRangeAt(0) : false;
      ta.select();
      ta.setSelectionRange(0, code.length);
      ta.readOnly = false;
      var result = document.execCommand("copy");
      // change icon
      $(this).attr("icon", result ? "carbon:checkmark" : "carbon:error");
      ta.blur(); // For iOS
      // blur
      $(copyIcon).blur();
      if (selected) {
        selection.removeAllRanges();
        selection.addRange(selected);
      }
      document.body.removeChild(ta);
      // setTimeout change icon
      setTimeout(() => {
        $(this).attr("icon", "carbon:copy");
      }, 1000); // 1s
    });

    // listen overflow-x change icon left
    $(this).scroll(function () {
      const scrollLeft = $(this).scrollLeft();
      const iconLeft = $(this).width() - leftOffset + scrollLeft;
      if (iconLeft > 0) {
        $(copyIcon).css("left", `${iconLeft}px`);
      }
    });
  });
}

$(document).ready(function () {
  registerMobileMenu();
  registerGoTop();
  registerSharePost();
  if ($("#article-title").length > 0) {
    registerHeaderPageTitle();
    registerCopyCode();
  }
});
