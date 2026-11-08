/** Every line below is draft for Armen, including the Armenian and Russian translations. */
export const BP_PHOTO_COPY_VERSION='bp-photo-draft-for-armen';
export const BP_PHOTO={
 // Draft for Armen.
 button:{en:'Take a photo of the monitor',hy:'Լուսանկարեք ճնշաչափի էկրանը',ru:'Сфотографируйте экран тонометра'},
 // Draft for Armen.
 read:(sys:number,dia:number,pulse:number)=>({en:`I read ${sys}/${dia}, pulse ${pulse}. Check the numbers, then save.`,hy:`Կարդացի ${sys}/${dia}, զարկը՝ ${pulse}։ Ստուգեք թվերը, ապա պահեք։`,ru:`На фото ${sys}/${dia}, пульс ${pulse}. Проверьте числа, затем сохраните.`}),
 // Draft for Armen.
 noPulse:(sys:number,dia:number)=>({en:`I read ${sys}/${dia}. Check the numbers, then save.`,hy:`Կարդացի ${sys}/${dia}։ Ստուգեք թվերը, ապա պահեք։`,ru:`На фото ${sys}/${dia}. Проверьте числа, затем сохраните.`}),
 // Draft for Armen.
 unclear:{en:'I could not read the screen clearly. Take another photo with the numbers filling the frame, or type them.',hy:'Չկարողացա հստակ կարդալ էկրանը։ Կրկին լուսանկարեք այնպես, որ թվերը լցնեն կադրը, կամ մուտքագրեք դրանք։',ru:'Не удалось чётко прочитать экран. Сделайте ещё одно фото, чтобы числа заполняли кадр, или введите их.'},
 // Draft for Armen.
 unavailable:{en:'Reading photos is not available now. Type the numbers instead.',hy:'Լուսանկարների ընթերցումն այժմ հասանելի չէ։ Մուտքագրեք թվերը։',ru:'Чтение фотографий сейчас недоступно. Введите числа.'},
 // Draft for Armen. Announces work to screen readers while the picker button is disabled.
 busy:{en:'Reading your photo…',hy:'Կարդում եմ ձեր լուսանկարը…',ru:'Читаем ваше фото…'},
} as const;
