import {test,expect} from '@playwright/test';
import {staffSignIn} from '../fixtures';

// A real sign-in, with the new nurse chat's flags on. Run with NOREON_E2E_NURSE_CHAT=true.
test.skip(process.env.NOREON_E2E_NURSE_CHAT!=='true','Needs the new nurse chat flags');

test('a nurse signs in to the new chat at the original address and can reach the previous screen',async({browser})=>{
 const {page}=await staffSignIn(browser,'nurse','en',{viewport:{width:402,height:714},isMobile:true,hasTouch:true});
 await expect(page).toHaveURL(/\/staff\/real\/nurse-chat$/);
 await expect(page.locator('.cv2-root')).toBeVisible();
 await expect(page.getByRole('log')).toBeVisible();
 await expect(page.locator('[data-nurse-chat-shell]')).toHaveCount(0);
 await page.locator('.cv2-avatar').click();
 await page.getByRole('button',{name:'Open the previous nurse screen',exact:true}).click();
 await expect(page).toHaveURL(/\/staff\/real\/nurse-chat\?previous=1$/);
 await expect(page.locator('[data-nurse-chat-shell]')).toBeVisible();
 await expect(page.locator('.cv2-root')).toHaveCount(0);
 await page.goto(page.url().replace(/\?previous=1$/,'-v2'));
 await expect(page).toHaveURL(/\/staff\/real\/nurse-chat$/);
 await expect(page.locator('.cv2-root')).toBeVisible();
});
