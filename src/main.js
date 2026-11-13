import { greeting } from "./greeting.js";

const heading = document.getElementById("greeting");
if (heading) heading.textContent = greeting("Engage");
