(function () {
  const faq = document.querySelector(".howto-faq");
  if (!faq) return;

  const items = [...faq.querySelectorAll(".howto-faq-item")];

  function setExclusiveOpen(targetDetails, open) {
    items.forEach((item) => {
      const details = item.querySelector(".howto-faq-details");
      details.open = details === targetDetails && open;
    });
  }

  items.forEach((item) => {
    const details = item.querySelector(".howto-faq-details");
    const summary = item.querySelector(".howto-faq-q");

    summary.addEventListener("click", (e) => e.preventDefault());

    item.addEventListener("click", (e) => {
      if (e.target.closest(".howto-faq-a")) return;
      setExclusiveOpen(details, !details.open);
    });

    summary.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      setExclusiveOpen(details, !details.open);
    });
  });
})();
