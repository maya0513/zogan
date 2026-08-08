import "./styles.css";

const copyButton = document.querySelector<HTMLButtonElement>("[data-copy]");

const copyWithSelection = (value: string): boolean => {
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  return copied;
};

copyButton?.addEventListener("click", async () => {
  const value = copyButton.dataset.copy;
  if (!value) return;

  try {
    await navigator.clipboard.writeText(value);
  } catch {
    if (!copyWithSelection(value)) {
      copyButton.textContent = "Select and copy";
      return;
    }
  }

  copyButton.textContent = "Copied";
  window.setTimeout(() => {
    copyButton.textContent = "Copy";
  }, 1800);
});

const navigation = document.querySelector<HTMLElement>("[data-navigation]");
const navigationToggle = document.querySelector<HTMLButtonElement>("[data-navigation-toggle]");

const closeNavigation = (): void => {
  if (!navigation || !navigationToggle) return;
  navigation.dataset.open = "false";
  navigationToggle.setAttribute("aria-expanded", "false");
  navigationToggle.setAttribute("aria-label", "Open navigation");
};

navigationToggle?.addEventListener("click", () => {
  if (!navigation) return;
  const open = navigation.dataset.open !== "true";
  navigation.dataset.open = String(open);
  navigationToggle.setAttribute("aria-expanded", String(open));
  navigationToggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
});

navigation
  ?.querySelectorAll("a")
  .forEach((link) => link.addEventListener("click", closeNavigation));

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) entry.target.setAttribute("data-visible", "true");
    }
  },
  { rootMargin: "0px 0px -12%", threshold: 0.08 },
);

document.querySelectorAll("[data-reveal]").forEach((element) => observer.observe(element));
